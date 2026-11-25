import type { EngineState } from '../../../../shared/engine/state';
import type { PresentationDoc } from '../../../../shared/library';
import type { RemoteSimple } from '../../../../shared/network-phone';
import { isPhoneDeck } from '../../../../shared/phone-decks';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import type { RemoteSide, RemoteTab } from './remote-store';

/*
 * What a paired phone shows and may do (alpha.23, QA23-PHONE-1). The owner's words: "no video access in either of
 * simple or pro mode in phone, they cant change videos, only ppts an pdfs, that also in pro mode, in simple mode only
 * show the flow, whats running in live, and chat. pro contains more features than simple", then "Only PPT and PDF".
 *
 * - Simple Mode on the computer: the Show tab (what is live as a view, its lines, the notes, what comes next, and the
 *   Sabha flow, always: the owner's Q3) and the Chat. No control at all.
 * - Pro Mode: that, the Playlist tab (the open playlist's PowerPoint and PDF rows), their slides to put up, and Back,
 *   Next (the buttons, or a swipe on the live picture) and Clear slide while a PowerPoint or a PDF is live (Q6, Q7).
 *
 * Never, in either mode: the library, More, the quick bar, the other clears, the time bar and what plays, the
 * computer's screens, videos, pictures and sounds, files, timers, messages or the stage. Drashti's own process refuses
 * all of it from a phone in any case (shared/phone-rule.ts); this is what the phone's page offers. Pure, so it is
 * tested apart (phone-mode.test.ts).
 */

/**
 * Said while a timer is shown alone over the PDF (a23-review-phoneui MUST-2): nothing of it goes up from a phone until
 * the computer takes the timer off (Drashti refuses a phone's every deck command then).
 */
export const TIMER_ALONE_WORDS = 'A timer is on the screens: the computer takes it off.';

export interface PhoneControls {
  /** A phone's tabs under the middle, in order. */
  tabs: RemoteTab[];
  /** A tablet held sideways: the tabs beside the live picture ('show' is the slides there). */
  panelTabs: RemoteTab[];
  /** A tablet held upright: what may be beside the show. */
  sides: RemoteSide[];
  /** Back and Next, the buttons and a swipe on the live picture. */
  backNext: boolean;
  swipes: boolean;
  /** Clear slide, the one clear a phone has. */
  clearSlide: boolean;
  /** The live PowerPoint's or PDF's slides, to put one up. */
  slides: boolean;
}

/** What the phone offers: `simple` is Simple Mode on the computer (null: Pro Mode); `deckLive`, deckLiveIn's. */
export function phoneControls(simple: RemoteSimple | null, deckLive: boolean): PhoneControls {
  if (simple)
    return {
      tabs: ['show', 'chat'],
      panelTabs: ['chat'],
      sides: ['chat'],
      backNext: false,
      swipes: false,
      clearSlide: false,
      slides: false,
    };
  return {
    tabs: ['show', 'playlist', 'chat'],
    panelTabs: ['show', 'playlist', 'chat'],
    sides: ['playlist', 'chat'],
    backNext: deckLive,
    swipes: deckLive,
    clearSlide: deckLive,
    slides: true,
  };
}

/**
 * Whether a PowerPoint or a PDF is live, as the phone can tell (the main process decides each request itself): the
 * live presentation's playlist row as Drashti marks it for a phone (phonePlays), or its slides once read (the remote
 * reads the live presentation: remote-store.ts follows what goes live); never while a timer is shown alone over it.
 */
export function deckLiveIn(
  state: EngineState | null,
  doc: PresentationDoc | null,
  items: readonly PlaylistItemInfo[] | null,
): boolean {
  const live = state?.live;
  const id = live?.presentationId ?? null;
  // A timer shown alone in the slide's place over it: Drashti refuses a phone's deck commands then (QA23-PHONE-1's
  // review, MUST-2), so the phone offers none.
  if (id === null || state?.layers.slide?.timer) return false;
  const itemId = live?.playlist?.itemId;
  const row = itemId ? items?.find((i) => i.id === itemId) : undefined;
  if (row?.kind === 'presentation' && row.presentationId === id && row.phonePlays === true) return true;
  return doc?.id === id && isPhoneDeck(doc);
}
