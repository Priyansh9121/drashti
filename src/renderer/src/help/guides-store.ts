import { create } from 'zustand';
import type { GuideId } from '../../../shared/guides';

/*
 * The Guides window (Sessions 31–36): Help › Guides…, in either mode. Open or not, the guide shown, the
 * passage to bring into view and mark (from a search or Read more), and what is searched.
 */

interface GuidesState {
  open: boolean;
  guide: GuideId;
  /** The passage to show and mark, or null. */
  passage: number | null;
  query: string;
}

export const useGuides = create<GuidesState>(() => ({
  open: false,
  guide: 'operator',
  passage: null,
  query: '',
}));

/** Open the guides, as they were, or at a guide's passage. */
export function showGuides(at?: { guide: GuideId; passage: number | null }): void {
  useGuides.setState((s) =>
    at ? { open: true, guide: at.guide, passage: at.passage, query: '' } : { ...s, open: true },
  );
}

export function closeGuides(): void {
  useGuides.setState({ open: false });
}
