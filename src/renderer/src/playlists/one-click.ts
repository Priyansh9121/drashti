import type { PlaylistItemInfo } from '../../../shared/playlists';
import { showItem } from '../library/library-store';
import { goLive, playItem } from '../operator/actions';
import { toggleFolded } from './fold-store';
import { clickItem, pickItem, templateOpen, usePlaylists } from './playlist-store';
import { startRepeat } from './repeat-actions';
import type { MiddleRow } from './rows';

/*
 * One click puts it live (Session 54, F2), as the operators' presentation program does; since Session 55 (Part 4)
 * the playlist is where everything goes live, with no second step: in Pro Mode's open playlist a click on any row puts
 * it on the screens at once, Enter on it too: a video, a picture or a sound (a sound on the audio layer), a video input
 * (the owner's answer to question 16), and each slide of a presentation, a PDF or a deck, which are rows under its
 * name. A click on that name folds its slides (Enter too). A file that cannot play (missing, being converted) goes to
 * the engine as well, which says why. Cmd-click (Ctrl-click on Windows) and Shift-click only mark, and right-click
 * opens the row's menu. A header is only chosen, a slot asks what goes there, a Repeat Slides playlist's row starts it
 * going round from there, and a template's rows never go up.
 *
 * Never two goes for one click: the second click of a double click (and a third) puts nothing up again, and a file
 * already up carries on as it was (the engine keeps its start time), so a click never restarts it; one played to its
 * end starts again from its start point (Session 55: the engine's playItem).
 */

/** A click on a row, as its event has it. */
export interface CardClick {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** Which click of a run this is: 1, then 2 for a double click's second; 0 for Enter on the row. */
  detail: number;
}

/** A row that goes up on its own: a picture, a video, a sound or a video input. */
export function goesUpOnClick(item: PlaylistItemInfo): boolean {
  return item.kind === 'media' || item.kind === 'input';
}

/**
 * What a click on an item's row does: `mark` it only (Cmd or Ctrl, or Shift), put it up (`go`), `fold` its slides
 * (a presentation's or a passage's name), `choose` it (a header; a slot asks what goes there), or nothing more (a
 * double click's second click, another key held).
 */
export function cardClick(
  item: PlaylistItemInfo,
  click: CardClick,
  platform: string,
  playlist: { template: boolean; repeat: boolean },
): 'mark' | 'go' | 'fold' | 'choose' | 'none' {
  const toggle = platform === 'darwin' ? click.metaKey : click.ctrlKey;
  if (toggle || click.shiftKey) return 'mark';
  // Any other key held (Alt, or Ctrl on a Mac, where Ctrl-click is a right-click) never puts anything up.
  const plain = !click.metaKey && !click.ctrlKey && !click.altKey;
  if (!plain) return 'choose';
  if (click.detail > 1) return 'none';
  if (item.kind === 'presentation' || item.kind === 'shastra') return 'fold';
  if (playlist.template || !goesUpOnClick(item)) return 'choose';
  return 'go';
}

/** What a click on a slide's row does: put it up (`go`), `mark` its item only, or nothing more. */
export function slideClick(click: CardClick, platform: string, template: boolean): 'mark' | 'go' | 'none' {
  const toggle = platform === 'darwin' ? click.metaKey : click.ctrlKey;
  if (toggle || click.shiftKey) return 'mark';
  const plain = !click.metaKey && !click.ctrlKey && !click.altKey;
  if (!plain || click.detail > 1) return 'none';
  return template ? 'mark' : 'go';
}

/** The open playlist's state for a click: its id, whether it is a template, and whether it goes round by itself. */
function openPlaylistNow() {
  const state = usePlaylists.getState();
  const { openId } = state;
  const repeat = state.tree.find((n) => n.id === openId)?.kind === 'repeat';
  return { openId, template: templateOpen(state), repeat };
}

/** A click (or Enter) on an item's row of the open playlist. */
export function clickCard(item: PlaylistItemInfo, click: CardClick, platform: string): void {
  const { openId, template, repeat } = openPlaylistNow();
  const does = cardClick(item, click, platform, { template, repeat });
  if (does === 'mark') {
    clickItem(item.id, {
      toggle: platform === 'darwin' ? click.metaKey : click.ctrlKey,
      range: click.shiftKey,
    });
    return;
  }
  if (does === 'none') return;
  if (does === 'fold') {
    clickItem(item.id, { toggle: false, range: false });
    toggleFolded(item.id);
    // Chosen as the playlist's item: Next with nothing up starts it at its first slide.
    if (openId && !repeat && !template) void showItem({ ...item, playlistId: openId });
    return;
  }
  if (does === 'go' && openId) {
    // A Repeat Slides playlist's picture: it goes round from there (Session 26d).
    if (repeat) {
      clickItem(item.id, { toggle: false, range: false });
      void startRepeat(openId, item.id);
      return;
    }
    // Up at once: choosing it does not wait for the engine's answer.
    void playItem(openId, item.id);
  }
  void pickItem(item);
}

/** A click (or Enter) on a slide's row in the open playlist: it goes up, from its item, in the item's order. */
export function clickSlideRow(
  row: Extract<MiddleRow, { kind: 'slide' }>,
  click: CardClick,
  platform: string,
): void {
  const { openId, template, repeat } = openPlaylistNow();
  const { item } = row;
  const does = slideClick(click, platform, template);
  if (does === 'none' || !openId || !item) return;
  if (does === 'mark') {
    clickItem(item.id, {
      toggle: platform === 'darwin' ? click.metaKey : click.ctrlKey,
      range: click.shiftKey,
    });
    return;
  }
  clickItem(item.id, { toggle: false, range: false });
  // A Repeat Slides playlist's step: it goes round from there (the engine's goLive on its own slides).
  void goLive(
    row.presentationId,
    row.at.position,
    row.arrangementId,
    repeat ? null : { playlistId: openId, itemId: item.id },
  );
  // Chosen as the playlist's item, so Next and Back go on from it.
  if (!repeat) void showItem({ ...item, playlistId: openId });
}

/**
 * How long the chosen card's Up and Down take no click after they appear (Session 54's review). A double click on
 * the card below the chosen one chooses it with its first click: the chosen one's Up and Down go, this card moves
 * up under the pointer, and its own Up and Down appear under it, where the second click lands. It would change
 * the running order, mid-show.
 */
export const JUST_SHOWN_MS = 500;

/**
 * Whether a press on a button that appeared at `shownAt` is meant (`detail`: the click's count, as `CardClick`'s):
 * from the keyboard at once (a click with no count), and a click once it has been there a moment.
 */
export function meantPress(detail: number, shownAt: number, now: number): boolean {
  return detail === 0 || now - shownAt >= JUST_SHOWN_MS;
}
