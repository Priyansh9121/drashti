import { create } from 'zustand';

/*
 * Jump by number (Session 55, Part 4, the owner's idea N): every row of the middle that goes up has a number
 * (playlists/rows.ts). With no field chosen, typing a row's number and pressing Enter puts that row up, as a click on it
 * does; the number shows while it is typed (JumpBox), Esc takes it away, Backspace its last digit, and any other key
 * takes it away and does what it always does (an arrow is still Next). Nothing acts while a dialog or a menu is open,
 * on a held key, or with Cmd, Ctrl or Alt.
 */

/** A row a number puts up. */
export interface JumpRow {
  number: number;
  go: () => void;
}

/** The most digits a number has (the longest playlist is well under 10,000 rows). */
const MAX_DIGITS = 4;
/** How long a number typed waits for Enter before it goes by itself. */
export const JUMP_WAIT_MS = 6000;

export const useJump = create<{
  /** The digits typed so far ('' for none). */
  typed: string;
  /** A number typed that has no row, said for a moment. */
  missed: number | null;
}>(() => ({ typed: '', missed: null }));

/** The middle's rows, as it shows them now. */
let rows: readonly JumpRow[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** The middle says which rows it shows (the open playlist's, or the library's chosen presentation's). */
export function setJumpRows(next: readonly JumpRow[]): void {
  rows = next;
}

function settle(typed: string): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  useJump.setState({ typed });
  if (typed !== '')
    timer = setTimeout(() => {
      timer = null;
      useJump.setState({ typed: '' });
    }, JUMP_WAIT_MS);
}

/** Take the number away (the practice show starting, the window losing a list). */
export function clearJump(): void {
  settle('');
}

/** What the jump reads of a key press: the key, the keys held, and whether the window lets it act. */
export interface JumpKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  /** A field has the keyboard. */
  typing: boolean;
  /** A dialog or a menu is open, or the practice show is on. */
  blocked: boolean;
}

/** A key press: true when the jump took it (the caller keeps it from the rest of the window). */
export function jumpKeyDown(e: JumpKey): boolean {
  const { typed } = useJump.getState();
  if (e.typing || e.blocked || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) {
    if (typed !== '') settle('');
    return false;
  }
  if (/^[0-9]$/u.test(e.key)) {
    if (e.repeat) return typed !== '';
    // A number never starts with 0.
    if (typed === '' && e.key === '0') return false;
    settle(typed.length >= MAX_DIGITS ? typed : typed + e.key);
    useJump.setState({ missed: null });
    return true;
  }
  if (typed === '') return false;
  if (e.key === 'Enter') {
    settle('');
    const number = Number(typed);
    const row = rows.find((r) => r.number === number);
    if (row) row.go();
    else useJump.setState({ missed: number });
    return true;
  }
  if (e.key === 'Escape') {
    settle('');
    return true;
  }
  if (e.key === 'Backspace') {
    // Digits only (a number, never words): its last digit off.
    settle(typed.length <= 1 ? '' : String(Math.floor(Number(typed) / 10)));
    return true;
  }
  // Shift alone (typing a digit on some keyboards) keeps the number.
  if (e.key === 'Shift') return false;
  settle('');
  return false;
}
