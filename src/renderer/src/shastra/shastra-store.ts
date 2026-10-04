import { create } from 'zustand';
import type { ShastraHit, ShastraTextInfo, ShastraTree } from '../../../shared/shastra';
import { leaveItem, selectPresentation, setLibraryTab, useLibrary } from '../library/library-store';

/*
 * The Shastra tab (Session 12): a reference box, search by words, and the
 * loaded texts to browse. A passage found any of these ways is shown in the
 * slide grid, as a presentation is, ready to go up.
 */

interface ShastraView {
  texts: ShastraTextInfo[];
  loaded: boolean;
  /** What is typed in the reference box, and why it names nothing (null while it is fine). */
  reference: string;
  problem: string | null;
  /** Search by words: what is typed, and what was found for it (null before an answer). */
  query: string;
  hits: ShastraHit[] | null;
  /** The text being browsed, and its sections and items. */
  browsing: ShastraTree | null;
  /** The Texts dialog (Pro Mode): loading, themes, removing. */
  textsOpen: boolean;
}

export const useShastra = create<ShastraView>(() => ({
  texts: [],
  loaded: false,
  reference: '',
  problem: null,
  query: '',
  hits: null,
  browsing: null,
  textsOpen: false,
}));

export async function loadTexts(): Promise<void> {
  const texts = await window.drashti.shastra.list();
  const { browsing } = useShastra.getState();
  useShastra.setState({ texts, loaded: true });
  // The text being browsed was loaded again (or removed).
  if (browsing) {
    const tree = texts.some((t) => t.id === browsing.text.id)
      ? await window.drashti.shastra.tree(browsing.text.id)
      : null;
    useShastra.setState({ browsing: tree });
  }
}

/** Show a passage in the slide grid. */
export async function showPassage(passageId: string): Promise<void> {
  leaveItem();
  useLibrary.setState({ focusSlideId: null });
  await selectPresentation(passageId);
}

export function setReference(reference: string): void {
  useShastra.setState({ reference, problem: null });
}

/** The reference box's Enter: the passage it names goes in the slide grid, or the box says why not. */
export async function openReference(reference = useShastra.getState().reference): Promise<boolean> {
  const result = await window.drashti.shastra.resolve(reference);
  if (!result.ok) {
    useShastra.setState({ problem: result.message });
    return false;
  }
  useShastra.setState({ problem: null });
  await showPassage(result.passage.passageId);
  return true;
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;

export function setQuery(query: string): void {
  useShastra.setState({ query });
  if (searchTimer) clearTimeout(searchTimer);
  if (query.trim() === '') {
    useShastra.setState({ hits: null });
    return;
  }
  searchTimer = setTimeout(() => {
    void window.drashti.shastra.search(query).then((hits) => {
      // Only the answer to what is in the box now.
      if (useShastra.getState().query === query) useShastra.setState({ hits });
    });
  }, 80);
}

export async function browse(textId: string | null): Promise<void> {
  useShastra.setState({ browsing: textId ? await window.drashti.shastra.tree(textId) : null });
}

/** An item clicked in the browser: it is the passage shown. */
export async function openItem(itemId: string): Promise<void> {
  const passage = await window.drashti.shastra.itemPassage(itemId);
  if (passage) await showPassage(passage.passageId);
}

export function openTexts(open: boolean): void {
  useShastra.setState({ textsOpen: open });
  if (open) void loadTexts();
}

/** The Shastra tab with the Texts dialog open (from the import report, for example). */
export function showTexts(): void {
  setLibraryTab('shastra');
  openTexts(true);
}

let watching = false;

/** The texts list follows what is loaded and removed. */
export function watchShastra(): void {
  if (watching) return;
  watching = true;
  window.drashti.library.onChanged((what) => {
    if (what === 'shastra' && useShastra.getState().loaded) void loadTexts();
  });
}
