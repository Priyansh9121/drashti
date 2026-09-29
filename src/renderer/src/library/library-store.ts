import { create } from 'zustand';
import type { PresentationDoc, PresentationSummary } from '../../../shared/library';
import type { MediaSummary } from '../../../shared/playlists';

interface LibraryView {
  presentations: PresentationSummary[];
  /** The presentation whose slides are shown. */
  selectedId: string | null;
  doc: PresentationDoc | null;
  /** Presentations marked for a list action such as Remove (the selected one and any added with Cmd/Ctrl or Shift). */
  marked: string[];
  /** Where a Shift-click range starts. */
  anchorId: string | null;
}

export const useLibrary = create<LibraryView>(() => ({
  presentations: [],
  selectedId: null,
  doc: null,
  marked: [],
  anchorId: null,
}));

export async function selectPresentation(id: string): Promise<void> {
  useLibrary.setState((s) => ({
    selectedId: id,
    marked: s.marked.includes(id) ? s.marked : [id],
    anchorId: s.anchorId ?? id,
  }));
  const doc = await window.drashti.library.getPresentation(id);
  // Ignore a slow answer for a presentation that is no longer selected.
  if (useLibrary.getState().selectedId === id) useLibrary.setState({ doc });
}

/**
 * A click in the presentation list: a plain click selects one presentation;
 * Cmd/Ctrl adds or takes one away; Shift marks the range from the last click.
 */
export function clickPresentation(id: string, mods: { toggle: boolean; range: boolean }): void {
  const { presentations, marked, anchorId } = useLibrary.getState();
  if (mods.range && anchorId) {
    const ids = presentations.map((p) => p.id);
    const from = ids.indexOf(anchorId);
    const to = ids.indexOf(id);
    if (from >= 0 && to >= 0) {
      useLibrary.setState({ marked: ids.slice(Math.min(from, to), Math.max(from, to) + 1) });
      void selectPresentation(id);
      return;
    }
  }
  if (mods.toggle) {
    const set = new Set(marked);
    if (set.has(id) && set.size > 1) set.delete(id);
    else set.add(id);
    useLibrary.setState({ marked: [...set], anchorId: id });
    const { selectedId } = useLibrary.getState();
    if (set.has(id)) void selectPresentation(id);
    else if (selectedId === id) void selectPresentation([...set][0] ?? id);
    return;
  }
  useLibrary.setState({ marked: [id], anchorId: id });
  void selectPresentation(id);
}

export async function loadLibrary(): Promise<void> {
  const presentations = await window.drashti.library.listPresentations();
  const ids = new Set(presentations.map((p) => p.id));
  const { selectedId, marked, anchorId } = useLibrary.getState();
  useLibrary.setState({
    presentations,
    marked: marked.filter((id) => ids.has(id)),
    anchorId: anchorId && ids.has(anchorId) ? anchorId : null,
  });
  if (selectedId && ids.has(selectedId)) return;
  // Nothing selected yet, or the selected presentation is gone (removed): select the first.
  const first = presentations[0];
  if (first) await selectPresentation(first.id);
  else useLibrary.setState({ selectedId: null, doc: null, marked: [] });
}

// ---- media ----------------------------------------------------------------------

interface MediaView {
  media: MediaSummary[];
  /** Loaded once the operator first looks at the media list. */
  loaded: boolean;
  /** Media marked for dragging into a playlist. */
  marked: string[];
  anchorId: string | null;
}

export const useMedia = create<MediaView>(() => ({ media: [], loaded: false, marked: [], anchorId: null }));

export async function loadMedia(): Promise<void> {
  const media = await window.drashti.library.listMedia();
  const ids = new Set(media.map((m) => m.id));
  useMedia.setState((s) => ({ media, loaded: true, marked: s.marked.filter((id) => ids.has(id)) }));
}

/** A click in the media list, marking like the presentation list. */
export function clickMedia(id: string, mods: { toggle: boolean; range: boolean }): void {
  const { media, marked, anchorId } = useMedia.getState();
  if (mods.range && anchorId) {
    const ids = media.map((m) => m.id);
    const from = ids.indexOf(anchorId);
    const to = ids.indexOf(id);
    if (from >= 0 && to >= 0) {
      useMedia.setState({ marked: ids.slice(Math.min(from, to), Math.max(from, to) + 1) });
      return;
    }
  }
  if (mods.toggle) {
    const set = new Set(marked);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    useMedia.setState({ marked: [...set], anchorId: id });
    return;
  }
  useMedia.setState({ marked: [id], anchorId: id });
}

let watching = false;

/** Reload the list (and the open presentation, which an import may have replaced) when the library changes. */
export function watchLibrary(): void {
  if (watching) return;
  watching = true;
  window.drashti.library.onChanged(() => {
    void loadLibrary().then(async () => {
      const { selectedId } = useLibrary.getState();
      if (selectedId) await selectPresentation(selectedId);
    });
    if (useMedia.getState().loaded) void loadMedia();
  });
}
