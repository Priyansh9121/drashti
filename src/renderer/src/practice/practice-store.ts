import { create } from 'zustand';
import type { EngineState } from '../../../shared/engine/state';
import type { OperatorAction } from '../../../shared/keymap';
import type { PresentationDoc } from '../../../shared/library';
import type { RenderSlide } from '../../../shared/model';
import type { PlaylistItemInfo } from '../../../shared/playlists';
import type { PracticeAction, Practice } from '../../../shared/practice';
import {
  PRACTICE_START,
  practiceLabels,
  practiceSlides,
  practiceState,
  practiceStep,
  practiceWords,
} from '../../../shared/practice';
import { useEngine } from '../engine/engine-store';
import { useNotice } from '../operator/actions';
import { itemOrder, rowName } from '../playlists/rows';

/*
 * The practice show (Session 26g), in this window only: its own little state (shared/practice.ts),
 * never sent to the main process. While it is on, the window's keys, MIDI pads and show buttons
 * work it instead of the show, and LIVE and the show controls draw it; the outputs, nodes, the
 * stream, recordings, phones and the API never hear of it, and nothing is saved.
 *
 * Session 55 (Part 4, the owner's idea T): a playlist can be practised the same way, from its menu: its rows (each
 * slide of its presentations, its pictures, its videos, and a card for a sound or a video input) in the window only,
 * a banner saying so.
 */

/** What is practised: the first start's placeholder slides, or a playlist's rows. */
export interface PracticeSource {
  /** The playlist's name; null for the first start's placeholder slides. */
  playlist: string | null;
  slides: RenderSlide[];
  labels: string[];
}

interface PracticeView {
  on: boolean;
  practice: Practice;
  source: PracticeSource;
  /** The practice as an EngineState, for LIVE and the show controls to draw. */
  state: EngineState;
}

const PLACEHOLDERS = (): PracticeSource => ({
  playlist: null,
  slides: practiceSlides(),
  labels: practiceLabels(),
});

const start = (source: PracticeSource): Pick<PracticeView, 'practice' | 'state' | 'source'> => ({
  practice: PRACTICE_START,
  source,
  state: practiceState(PRACTICE_START, source.slides),
});

export const usePractice = create<PracticeView>(() => ({ on: false, ...start(PLACEHOLDERS()) }));

/** The first start's practice show: its placeholder slides. */
export function startPractice(): void {
  usePractice.setState({ on: true, ...start(PLACEHOLDERS()) });
}

export function stopPractice(): void {
  usePractice.setState({ on: false, ...start(PLACEHOLDERS()) });
}

/** A picture or a video as a slide of its own, filling it as the screens fit it. */
function mediaSlide(id: string, mediaId: string, kind: 'image' | 'video'): RenderSlide {
  return {
    id,
    width: 1920,
    height: 1080,
    background: '#000000',
    elements: [
      { id: `${id}-m`, kind, mediaId, frame: { x: 0, y: 0, width: 1920, height: 1080 }, fit: 'fit' },
    ],
  };
}

/**
 * A playlist's rows as practice slides (Session 55): each presentation's slides in the order the playlist plays them
 * ("<name>_N"), each picture and video as a slide of its own, and a sound or a video input as a card saying what it
 * is (the practice plays no sound and opens no camera). Headers and slots have nothing to show.
 */
export function practiceRows(
  items: readonly PlaylistItemInfo[],
  docs: ReadonlyMap<string, PresentationDoc | null>,
): Pick<PracticeSource, 'slides' | 'labels'> {
  const slides: RenderSlide[] = [];
  const labels: string[] = [];
  for (const item of items) {
    if (item.kind === 'presentation' || item.kind === 'shastra') {
      const id = item.kind === 'presentation' ? item.presentationId : item.passageId;
      const doc = docs.get(id) ?? null;
      if (!doc) continue;
      const name = item.kind === 'presentation' ? (item.presentationName ?? item.label) : doc.name;
      for (const o of itemOrder(item, doc).slides) {
        slides.push({ ...o.slide.slide, id: `${item.id}/${String(o.position)}` });
        labels.push(rowName(name, item, o));
      }
    } else if (item.kind === 'media' && !item.missing) {
      if (item.media === 'audio') slides.push(practiceWords(`${item.id}/card`, `Sound: ${item.label}`));
      else slides.push(mediaSlide(`${item.id}/media`, item.mediaId, item.media));
      labels.push(item.label);
    } else if (item.kind === 'input') {
      slides.push(practiceWords(`${item.id}/card`, `Video input: ${item.label}`));
      labels.push(item.label);
    }
  }
  return { slides, labels };
}

/**
 * Practise a playlist (Session 55, Part 4): its rows in this window only, as the first start's practice show runs.
 * Nothing goes on the screens, the phones or the stream; the banner says so.
 */
export async function practisePlaylist(playlistId: string): Promise<void> {
  const d = window.drashti;
  const [items, tree] = await Promise.all([d.playlists.items(playlistId), d.playlists.tree()]);
  const ids = [
    ...new Set(
      items.flatMap((i) =>
        i.kind === 'presentation' && i.presentationName !== null
          ? [i.presentationId]
          : i.kind === 'shastra' && !i.missing
            ? [i.passageId]
            : [],
      ),
    ),
  ];
  const read = await Promise.all(ids.map((id) => d.library.getPresentation(id).catch(() => null)));
  const docs = new Map(ids.map((id, i) => [id, read[i] ?? null]));
  const rows = practiceRows(items, docs);
  if (rows.slides.length === 0) {
    useNotice.setState({
      text: 'That playlist has nothing to practise yet: add a presentation, a picture or a video.',
    });
    return;
  }
  const playlist = tree.find((n) => n.id === playlistId)?.name ?? 'the playlist';
  usePractice.setState({ on: true, ...start({ playlist, ...rows }) });
}

/** One step of the practice show. */
export function runPractice(action: PracticeAction): void {
  const { practice, source } = usePractice.getState();
  const next = practiceStep(practice, action, source.slides.length);
  if (next !== practice) usePractice.setState({ practice: next, state: practiceState(next, source.slides) });
}

/** What a show key does in the practice show (the others do nothing there). */
const KEYS: Partial<Record<OperatorAction, PracticeAction>> = {
  next: 'next',
  previous: 'previous',
  nextItem: 'next',
  previousItem: 'previous',
  clearAll: 'clearAll',
  clearSlide: 'clearSlide',
  toggleBlackout: 'toggleBlackout',
  toggleWallpaper: 'toggleWallpaper',
};

/** A key or button while practising: true when the practice show took it. */
export function practiceKey(action: OperatorAction | 'back' | 'putBack'): boolean {
  if (!usePractice.getState().on) return false;
  const step = action === 'back' || action === 'putBack' ? action : KEYS[action];
  if (step) runPractice(step);
  return true;
}

/** The show as this window draws it: the practice show while it is on, else the engine's state. */
export function useShowState(): EngineState | null {
  const on = usePractice((s) => s.on);
  const practice = usePractice((s) => s.state);
  const real = useEngine((s) => s.state);
  return on ? practice : real;
}

/** Its revision, so pictures know when to draw again. */
export function useShowRev(): number {
  const on = usePractice((s) => s.on);
  const practice = usePractice((s) => s.practice.rev);
  const real = useEngine((s) => s.rev);
  return on ? practice : real;
}
