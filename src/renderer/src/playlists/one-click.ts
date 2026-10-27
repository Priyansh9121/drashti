import type { PlaylistItemInfo } from '../../../shared/playlists';
import { playItem } from '../operator/actions';
import { clickItem, pickItem, templateOpen, usePlaylists } from './playlist-store';

/*
 * One click puts it live (Session 54, F2), as the operators' presentation program does: in Pro Mode's open
 * playlist, a click on a video, a picture or a sound puts it on the screens at once (a sound on the audio layer),
 * and Enter on its card does the same. Cmd-click (Ctrl-click on Windows) and Shift-click still only mark, and
 * right-click still opens the card's menu. A presentation (a PDF and a deck too), a Shastra passage, a video
 * input, a header and a slot open in the middle as before, and so does a file that cannot play (missing, or
 * being converted), where the middle says why; a Repeat Slides playlist's items show its steps (they go round
 * from the grid), and a template's never go up. Simple Mode keeps its own rows and its Next.
 *
 * Never two goes for one click: the second click of a double click (and a third) puts nothing up again, and a
 * file already up carries on as it was (the engine keeps its start time), so a click never restarts it.
 */

/** A click on a card, as its event has it. */
export interface CardClick {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** Which click of a run this is: 1, then 2 for a double click's second; 0 for Enter on the card. */
  detail: number;
}

/** A video, a picture or a sound that can play: what one click puts up. */
export function goesUpOnClick(item: PlaylistItemInfo): boolean {
  return item.kind === 'media' && !item.missing && item.unplayable === null;
}

/**
 * What a click on a card does: `mark` it only (Cmd or Ctrl, or Shift), put it up (`go`, and show it in the
 * middle), or `show` it in the middle, as every click did until Session 54.
 */
export function cardClick(
  item: PlaylistItemInfo,
  click: CardClick,
  platform: string,
  playlist: { template: boolean; repeat: boolean },
): 'mark' | 'go' | 'show' {
  const toggle = platform === 'darwin' ? click.metaKey : click.ctrlKey;
  if (toggle || click.shiftKey) return 'mark';
  // Any other key held (Alt, or Ctrl on a Mac, where Ctrl-click is a right-click) never puts anything up.
  const plain = !click.metaKey && !click.ctrlKey && !click.altKey;
  if (!plain || click.detail > 1 || playlist.template || playlist.repeat) return 'show';
  return goesUpOnClick(item) ? 'go' : 'show';
}

/** A click (or Enter) on a card of the open playlist. */
export function clickCard(item: PlaylistItemInfo, click: CardClick, platform: string): void {
  const state = usePlaylists.getState();
  const { openId } = state;
  const repeat = state.tree.find((n) => n.id === openId)?.kind === 'repeat';
  const does = cardClick(item, click, platform, { template: templateOpen(state), repeat });
  if (does === 'mark') {
    clickItem(item.id, {
      toggle: platform === 'darwin' ? click.metaKey : click.ctrlKey,
      range: click.shiftKey,
    });
    return;
  }
  // Up at once: showing it in the middle does not wait for the engine's answer.
  if (does === 'go' && openId) void playItem(openId, item.id);
  void pickItem(item);
}
