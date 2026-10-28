import { useEffect, useMemo, useRef, useState } from 'react';
import {
  EDIT_WORDS,
  editsFor,
  endsCell,
  shownPeople,
  STATUS_ORDER,
  STATUS_WORDS,
  statusCounts,
  statusDetail,
  statusWord,
  updatedWords,
  type AccessEdit,
  type StatusFilter,
} from '../../../shared/access-list';
import { gmailKey, type AccessPerson } from '../../../shared/access-protocol';
import { plural } from '../../../shared/text';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { TextInput } from '../ui/Field';
import { Download, ListFilter, Search, UserPlus, Users } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { EmptyState, ErrorState, Loading } from '../ui/States';
import { AddGmailDialog, LengthDialog, NoteDialog, RevokeDialog } from './AccessDialogs';
import { AccessTable } from './AccessTable';
import {
  choose,
  connectAccessList,
  dismissSaid,
  edit,
  exportShown,
  openDialog,
  sortBy,
  tryAgain,
  useAccessList,
} from './access-list-store';

/*
 * View › Access List… (Session 54, E4): the owner's window onto the access list in their Google account, easy to
 * read: who is on it and how they stand, one row each, sorted by any column, shown by status, searched, and saved
 * as a CSV; the chosen Gmail's edits in the bar under the table (Revoke asks first; Approve, Give access again and
 * Change the length ask how long access lasts); when each Gmail's access ends; and Add a Gmail…. The list is
 * asked again every few seconds while the window is open ("Updated just now"), so a request, an Approve link or a
 * status typed into the Sheet shows here within seconds.
 */

/** This computer's clock, ticking: for "Updated just now" and "Last seen". */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, everyMs);
    return () => {
      clearInterval(t);
    };
  }, [everyMs]);
  return now;
}

const FILTERS: readonly StatusFilter[] = ['all', ...STATUS_ORDER];
const FILTER_WORDS: Record<StatusFilter, string> = { all: 'All', ...STATUS_WORDS };

/** After an edit whose button went (Approve, once approved), the keyboard goes back to the chosen row. */
function keyboardBack(): void {
  requestAnimationFrame(() => {
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused.isConnected) return;
    const key = useAccessList.getState().chosen;
    const row =
      key === null ? null : document.querySelector<HTMLElement>(`[data-row-button="${CSS.escape(key)}"]`);
    (row ?? document.querySelector<HTMLElement>('[data-testid="access-search"]'))?.focus();
  });
}

function act(kind: AccessEdit, gmail: string): void {
  if (kind === 'revoke') openDialog({ kind: 'revoke', gmail });
  else if (kind === 'note') openDialog({ kind: 'note', gmail });
  else if (kind === 'approve' || kind === 'regrant' || kind === 'length')
    openDialog({ kind: 'length', edit: kind, gmail });
  else void edit(kind, gmail).then(keyboardBack);
}

/** The chosen Gmail and its edits, under the table (next after it in the Tab order). */
function ChosenBar({ person }: { person: AccessPerson | null }) {
  const busy = useAccessList((s) => s.busy);
  const listTime = useAccessList((s) => s.view?.listTime ?? null);
  const detail = person ? statusDetail(person) : '';
  const ends = person ? endsCell(person, listTime).text : '';
  return (
    <section
      aria-label="The Gmail chosen"
      className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-panel px-4 py-2"
      data-testid="access-chosen"
    >
      {person ? (
        <>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold" title={person.gmail} data-testid="access-chosen-gmail">
              {person.gmail}
            </p>
            <p className="truncate text-xs text-muted">
              {statusWord(person.status)}
              {detail ? ` · ${detail}` : ''}
              {ends ? ` · Access ends: ${ends}` : ''}
            </p>
          </div>
          <span role="status" className="text-xs text-muted">
            {busy ? 'Asking the access list…' : ''}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {editsFor(person).map((kind) => (
              <Button
                key={kind}
                variant={kind === 'revoke' ? 'danger' : 'secondary'}
                disabled={busy}
                data-testid={`access-${kind}`}
                onClick={() => {
                  act(kind, person.gmail);
                }}
              >
                {EDIT_WORDS[kind]}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="min-w-0 flex-1 text-sm text-muted">
            Choose a Gmail in the list for what you can do with it: approve, reject, revoke, give access
            again, change how long access lasts, or a note.
          </p>
          <span role="status" className="text-xs text-muted">
            {busy ? 'Asking the access list…' : ''}
          </span>
        </>
      )}
    </section>
  );
}

/** All, or one status, each with how many: one Tab stop, the arrows between them. */
function StatusChoice({ counts }: { counts: Record<StatusFilter, number> }) {
  const status = useAccessList((s) => s.status);
  const pick = (f: StatusFilter) => {
    useAccessList.setState({ status: f });
  };
  return (
    <div
      role="radiogroup"
      aria-label="Show"
      className="inline-flex flex-wrap items-center gap-0.5 rounded-md border border-field bg-panel-2 p-0.5"
      onKeyDown={radioKeys(FILTERS, status, pick)}
    >
      {FILTERS.map((f, i) => {
        const on = f === status;
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={radioTabIndex(on, i, true)}
            data-testid={`access-show-${f}`}
            className={cx(
              'inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-xs',
              on
                ? 'border-line-strong bg-panel-3 font-bold text-fg'
                : 'border-transparent font-medium text-muted hover:bg-panel-3 hover:text-fg',
            )}
            onClick={() => {
              pick(f);
            }}
          >
            {FILTER_WORDS[f]}
            <span className="tabular-nums">{counts[f].toLocaleString('en')}</span>
          </button>
        );
      })}
    </div>
  );
}

export function AccessListApp() {
  useEffect(() => {
    connectAccessList();
  }, []);
  const view = useAccessList((s) => s.view);
  const sort = useAccessList((s) => s.sort);
  const status = useAccessList((s) => s.status);
  const search = useAccessList((s) => s.search);
  const chosen = useAccessList((s) => s.chosen);
  const reveal = useAccessList((s) => s.reveal);
  const busy = useAccessList((s) => s.busy);
  const said = useAccessList((s) => s.said);
  const dialog = useAccessList((s) => s.dialog);
  const now = useNow(5_000);
  const searchBox = useRef<HTMLInputElement>(null);

  const people = view?.people ?? null;
  const shown = useMemo(
    () => (people ? shownPeople(people, { status, search, sort }) : []),
    [people, status, search, sort],
  );
  const counts = useMemo(() => statusCounts(people ?? []), [people]);
  const chosenPerson = chosen === null ? null : (shown.find((p) => gmailKey(p.gmail) === chosen) ?? null);
  const updatedAt = view?.updatedAt ?? null;
  // Why the list could not be asked just now, over the list it last gave (with none, said in its place).
  const problem = people === null ? null : (view?.problem ?? null);

  // ⌘F (Ctrl+F) goes to the search, unless a dialog has the keyboard.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      searchBox.current?.focus();
      searchBox.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const showAll = () => {
    useAccessList.setState({ status: 'all', search: '' });
  };

  let place;
  if (view === null || (people === null && view.problem === null))
    place = <Loading label="Asking the access list…" className="flex-1" />;
  else if (people === null)
    place = (
      <ErrorState
        title="Drashti couldn’t show the access list"
        className="flex-1 justify-center"
        action={
          <Button variant="primary" onClick={() => void tryAgain()}>
            Try again
          </Button>
        }
      >
        {view.problem}
      </ErrorState>
    );
  else if (people.length === 0)
    place = (
      <EmptyState
        icon={Users}
        title="No one is on the access list yet"
        className="flex-1"
        action={
          <Button
            icon={UserPlus}
            onClick={() => {
              openDialog({ kind: 'add' });
            }}
          >
            Add a Gmail…
          </Button>
        }
      >
        A person asks from the lock screen of their own Drashti, or you add their Gmail here.
      </EmptyState>
    );
  else if (shown.length === 0)
    place = (
      <EmptyState
        icon={ListFilter}
        title="No Gmail matches"
        className="flex-1"
        data-testid="access-none-shown"
        action={<Button onClick={showAll}>Show every Gmail</Button>}
      >
        None of the Gmails with the status chosen matches the search.
      </EmptyState>
    );
  else
    place = (
      <AccessTable
        people={shown}
        sort={sort}
        onSort={sortBy}
        chosen={chosen}
        onChoose={choose}
        reveal={reveal}
        now={now}
        listTime={view.listTime}
      />
    );

  // Below 640 × 420 (200% zoom in a small window), the window scrolls rather than squeezing the list away.
  return (
    <div className="flex h-full min-h-[420px] min-w-[640px] flex-col bg-ink text-fg">
      <header
        className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-panel px-4 py-2.5"
        data-testid="access-header"
      >
        <h1 className="text-lg font-bold">Access List</h1>
        <p className="text-sm text-muted" data-testid="access-summary">
          {people === null
            ? ''
            : `${plural(counts.all, 'Gmail')}${counts.requested > 0 ? ` · ${plural(counts.requested, 'request')} waiting` : ''}`}
        </p>
        <p className="ml-auto text-xs text-muted" data-testid="access-updated">
          {updatedWords(updatedAt, Math.max(now, updatedAt ?? 0))}
        </p>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        <div
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2"
          data-testid="access-toolbar"
        >
          <span className="relative inline-flex w-56 min-w-40 items-center">
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2 text-muted" />
            <TextInput
              ref={searchBox}
              type="search"
              value={search}
              aria-label="Search the list"
              placeholder="Gmail, name, computer or note"
              spellCheck={false}
              className="w-full pl-7"
              data-testid="access-search"
              onChange={(e) => {
                useAccessList.setState({ search: e.target.value });
              }}
            />
          </span>
          <StatusChoice counts={counts} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              icon={UserPlus}
              disabled={people === null}
              data-testid="access-add-open"
              onClick={() => {
                openDialog({ kind: 'add' });
              }}
            >
              Add a Gmail…
            </Button>
            <Button
              icon={Download}
              disabled={busy || shown.length === 0}
              title="Saves the rows shown, in their order, as a CSV file"
              data-testid="access-export"
              onClick={() => void exportShown(shown.map((p) => p.gmail))}
            >
              Export CSV…
            </Button>
          </div>
        </div>
        {(said !== null || problem !== null) && (
          <div className="shrink-0 space-y-2 px-4 pt-2">
            {problem !== null && (
              <Notice
                tone="warning"
                data-testid="access-problem"
                actions={
                  <Button size="sm" onClick={() => void tryAgain()}>
                    Try again
                  </Button>
                }
              >
                {problem}
              </Notice>
            )}
            {said && (
              <Notice tone={said.ok ? 'success' : 'danger'} onDismiss={dismissSaid} data-testid="access-said">
                {said.text}
              </Notice>
            )}
          </div>
        )}
        <div className={cx('flex min-h-0 flex-1 flex-col', (said !== null || problem !== null) && 'pt-2')}>
          {place}
        </div>
        <ChosenBar person={chosenPerson} />
      </main>
      {dialog?.kind === 'add' && <AddGmailDialog />}
      {dialog?.kind === 'note' && <NoteDialog key={dialog.gmail} gmail={dialog.gmail} />}
      {dialog?.kind === 'revoke' && <RevokeDialog gmail={dialog.gmail} done={keyboardBack} />}
      {dialog?.kind === 'length' && (
        <LengthDialog key={`${dialog.edit}:${dialog.gmail}`} kind={dialog.edit} gmail={dialog.gmail} />
      )}
    </div>
  );
}
