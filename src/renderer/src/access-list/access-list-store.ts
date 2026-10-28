import { create } from 'zustand';
import {
  DEFAULT_SORT,
  type AccessColumn,
  type AccessEdit,
  type AccessListAdd,
  type AccessListResult,
  type AccessListView,
  type AccessSort,
  type StatusFilter,
} from '../../../shared/access-list';
import { gmailKey, type AccessLength } from '../../../shared/access-protocol';

/*
 * The Access List's page (Session 54, E4): the list as the main process last had it from the owner's Google
 * account (it asks again every few seconds while this window is open, and after each edit), and the window's own
 * choices: the sort, the status shown, the search, the Gmail chosen, the dialog open and the last edit's outcome.
 * Every edit goes through the main process, which alone asks the list, as the owner.
 */

/** An edit that asks how long access lasts first (the owner's decision of 28 Oct 2026). */
export type LengthEdit = 'approve' | 'regrant' | 'length';

export type AccessDialog =
  | { kind: 'add' }
  | { kind: 'note'; gmail: string }
  | { kind: 'revoke'; gmail: string }
  | { kind: 'length'; edit: LengthEdit; gmail: string }
  | null;

interface AccessListPage {
  /** As the main process last told it; null until it first has. */
  view: AccessListView | null;
  sort: AccessSort;
  status: StatusFilter;
  search: string;
  /** The Gmail chosen (its gmailKey), whose edits the bar under the list offers. */
  chosen: string | null;
  /** Bring the chosen row into view: changed each time it should be. */
  reveal: number;
  /** An edit or a save under way: one at a time. */
  busy: boolean;
  /** What the last edit or save came to, in words. */
  said: { ok: boolean; text: string } | null;
  dialog: AccessDialog;
  /** Why the open dialog's edit was not done, shown in it. */
  dialogProblem: string | null;
}

export const useAccessList = create<AccessListPage>(() => ({
  view: null,
  sort: DEFAULT_SORT,
  status: 'all',
  search: '',
  chosen: null,
  reveal: 0,
  busy: false,
  said: null,
  dialog: null,
  dialogProblem: null,
}));

let connected = false;

/** Hear each answer of the list, and ask for the one the main process has now. */
export function connectAccessList(): void {
  if (connected) return;
  connected = true;
  window.drashti.accessList.onChanged((view) => {
    useAccessList.setState({ view });
  });
  void window.drashti.accessList.view().then(
    (view) => {
      // An answer heard meanwhile is newer.
      if (useAccessList.getState().view === null) useAccessList.setState({ view });
    },
    // Refused (this computer no longer the owner's, let in): the window is closing.
    () => undefined,
  );
}

/** Ask the list again now (Try again). */
export async function tryAgain(): Promise<void> {
  try {
    const view = await window.drashti.accessList.refresh();
    useAccessList.setState({ view });
  } catch {
    // Refused (this computer no longer the owner's, let in): the window is closing.
  }
}

/** Sort by a column: by it, then the other way when it is the one sorted by already. */
export function sortBy(column: AccessColumn): void {
  const { sort } = useAccessList.getState();
  useAccessList.setState({
    sort: { column, descending: sort.column === column ? !sort.descending : false },
    reveal: useAccessList.getState().reveal + 1,
  });
}

export function choose(gmail: string | null, reveal = false): void {
  const s = useAccessList.getState();
  useAccessList.setState({
    chosen: gmail === null ? null : gmailKey(gmail),
    reveal: reveal ? s.reveal + 1 : s.reveal,
  });
}

export function openDialog(dialog: AccessDialog): void {
  useAccessList.setState({ dialog, dialogProblem: null });
}

export function closeDialog(): void {
  useAccessList.setState({ dialog: null, dialogProblem: null });
}

/** An edit's outcome: the list as it is now, and what happened, said under the toolbar. */
function heard(result: AccessListResult, closing: boolean): void {
  useAccessList.setState((s) => ({
    view: result.view.people === null && s.view?.people ? s.view : result.view,
    busy: false,
    said: { ok: result.ok, text: result.message },
    ...(closing ? { dialog: null, dialogProblem: null } : {}),
    reveal: s.reveal + 1,
  }));
}

async function run(
  edit: () => Promise<AccessListResult>,
  closing: boolean,
): Promise<AccessListResult | null> {
  if (useAccessList.getState().busy) return null;
  useAccessList.setState({ busy: true, said: null });
  try {
    const result = await edit();
    heard(result, closing);
    return result;
  } catch {
    useAccessList.setState({
      busy: false,
      said: { ok: false, text: 'Drashti couldn’t send that to the access list: try again.' },
    });
    return null;
  }
}

/** Reject or Revoke (Revoke is asked first, by its dialog). */
export function edit(
  kind: Exclude<AccessEdit, 'note' | LengthEdit>,
  gmail: string,
): Promise<AccessListResult | null> {
  const bridge = window.drashti.accessList;
  const calls = {
    reject: () => bridge.reject(gmail),
    revoke: () => bridge.revoke(gmail),
  };
  return run(calls[kind], kind === 'revoke');
}

/**
 * Approve, Give access again or Change the length, with the length chosen in its dialog: the dialog closes once it is
 * done, and says why not when it is not.
 */
export async function giveLength(kind: LengthEdit, gmail: string, length: AccessLength): Promise<void> {
  const bridge = window.drashti.accessList;
  const calls = {
    approve: () => bridge.approve(gmail, length),
    regrant: () => bridge.regrant(gmail, length),
    length: () => bridge.changeLength(gmail, length),
  };
  const result = await run(calls[kind], false);
  if (result?.ok) closeDialog();
  else if (result) useAccessList.setState({ dialogProblem: result.message, said: null });
}

/** Save a Gmail's note (from its dialog, which closes once it is saved). */
export async function saveNote(gmail: string, note: string): Promise<void> {
  const result = await run(() => window.drashti.accessList.note(gmail, note), false);
  if (result?.ok) closeDialog();
  else if (result) useAccessList.setState({ dialogProblem: result.message, said: null });
}

/** Add a Gmail (from its dialog): it is chosen in the list once it is there. */
export async function addGmail(fields: AccessListAdd): Promise<void> {
  const result = await run(() => window.drashti.accessList.add(fields), false);
  if (!result) return;
  // Not added at all: said in the dialog, which stays open to put it right. Added (approved or not): said here.
  const added = result.view.people?.some((p) => gmailKey(p.gmail) === gmailKey(fields.gmail)) ?? false;
  if (result.ok || added) {
    closeDialog();
    choose(fields.gmail, true);
  } else useAccessList.setState({ dialogProblem: result.message, said: null });
}

/** Save the rows shown, in their order, as a CSV where the owner chooses. */
export async function exportShown(gmails: string[]): Promise<void> {
  if (useAccessList.getState().busy) return;
  useAccessList.setState({ busy: true, said: null });
  try {
    const saved = await window.drashti.accessList.exportCsv(gmails);
    useAccessList.setState({
      busy: false,
      said: saved.message === null ? null : { ok: saved.ok, text: saved.message },
    });
  } catch {
    useAccessList.setState({
      busy: false,
      said: { ok: false, text: 'Drashti couldn’t save the CSV: try again.' },
    });
  }
}

export function dismissSaid(): void {
  useAccessList.setState({ said: null });
}
