import { create } from 'zustand';
import type { QuickPin, QuickRowKind } from '../../../shared/quick-bar';
import { movedPin, pinKey, QUICK_BAR_MAX, withoutPin, withPin } from '../../../shared/quick-bar';
import { fillMessage } from '../../../shared/messages';
import { playOrder } from '../../../shared/order';
import { useEngine } from '../engine/engine-store';
import type { FileTarget } from '../files/file-menu';
import { dispatch, goLive, playItem, runInTurn, useNotice } from '../operator/actions';
import { itemOrder } from '../playlists/rows';
import type { MenuEntry } from '../ui/Menu';
import { Pin, PinOff } from '../ui/icons';

/*
 * The quick bar (Session 55, Part 8, the owner's idea F) in Pro Mode's window: its pins, kept with the library (the main
 * process holds them), pinned from the one right-click menu and from Messages, and each put up with one press (a click,
 * or Alt+1 to Alt+8): a playlist's row as a click on the row puts it up, a slide's row from its row (found by the
 * slide's id in the order its row plays now), a picture or video from Media as the picture (the slide taken off, as a
 * picture's row does), a sound as the sound, and a message as its Show does. Something gone since it was pinned says so.
 */

export const useQuickBar = create<{ pins: QuickPin[] }>(() => ({ pins: [] }));

let connected = false;

/** The bar as the library keeps it, and every change to it, from the window's start. */
export function connectQuickBar(): void {
  if (connected) return;
  connected = true;
  window.drashti.quickBar.onChanged((pins) => {
    useQuickBar.setState({ pins });
  });
  void window.drashti.quickBar.view().then((pins) => {
    useQuickBar.setState({ pins });
  });
}

const say = (text: string) => {
  useNotice.setState({ text });
};

async function save(pins: QuickPin[]): Promise<void> {
  const result = await window.drashti.quickBar.set(pins);
  if (result.ok) useQuickBar.setState({ pins: result.pins });
  else say(result.message);
}

export function isPinned(pin: QuickPin): boolean {
  const key = pinKey(pin);
  return useQuickBar.getState().pins.some((p) => pinKey(p) === key);
}

/** Pin at the end of the bar; a full bar says what to do. */
export async function pinIt(pin: QuickPin): Promise<void> {
  const { pins, full } = withPin(useQuickBar.getState().pins, pin);
  if (full) {
    say(`The quick bar holds ${String(QUICK_BAR_MAX)}: take one off (right-click it) to pin “${pin.label}”.`);
    return;
  }
  await save(pins);
}

export async function unpin(key: string): Promise<void> {
  await save(withoutPin(useQuickBar.getState().pins, key));
}

export async function movePin(key: string, by: -1 | 1): Promise<void> {
  await save(movedPin(useQuickBar.getState().pins, key, by));
}

const ROW_KIND: Partial<Record<FileTarget['kind'], QuickRowKind>> = {
  picture: 'picture',
  video: 'video',
  sound: 'sound',
  input: 'input',
  presentation: 'presentation',
  deck: 'presentation',
  passage: 'presentation',
};
const MEDIA_OF = { picture: 'image', video: 'video', sound: 'audio' } as const;

/**
 * What a right-click's thing pins as, or null: a slide's row, a playlist's row that goes up (a picture, video, sound,
 * video input, presentation or passage), or a picture, video or sound in Media or an audio playlist.
 */
export function pinFor(target: FileTarget): QuickPin | null {
  if (target.kind === 'slide') {
    if (target.presentationId === undefined || target.slideId === undefined) return null;
    const fromRow = target.playlistId !== undefined && target.itemId !== undefined;
    return {
      kind: 'slide',
      presentationId: target.presentationId,
      slideId: target.slideId,
      playlistId: fromRow ? (target.playlistId ?? null) : null,
      itemId: fromRow ? (target.itemId ?? null) : null,
      label: target.name,
    };
  }
  const what = ROW_KIND[target.kind];
  if (target.place === 'playlist' && target.playlistId !== undefined && target.itemId !== undefined && what)
    return {
      kind: 'item',
      playlistId: target.playlistId,
      itemId: target.itemId,
      label: target.name,
      what,
    };
  if (
    (target.place === 'media' || target.place === 'music') &&
    target.mediaId !== undefined &&
    (target.kind === 'picture' || target.kind === 'video' || target.kind === 'sound')
  )
    return { kind: 'media', mediaId: target.mediaId, media: MEDIA_OF[target.kind], label: target.name };
  return null;
}

/** The one right-click menu's entry (added to every menu by Pro Mode's window): Pin, or Unpin when pinned. */
export function quickMenuItems(target: FileTarget): MenuEntry[] {
  const pin = pinFor(target);
  if (!pin) return [];
  return isPinned(pin)
    ? [{ label: 'Unpin from the quick bar', icon: PinOff, onSelect: () => void unpin(pinKey(pin)) }]
    : [{ label: 'Pin to the quick bar', icon: Pin, onSelect: () => void pinIt(pin) }];
}

const gone = (pin: QuickPin, where: string) => {
  say(`“${pin.label}” is no longer ${where}: right-click it on the quick bar to take it off.`);
};

/** A slide's pin: from its row, found by the slide's id in the order its row plays now; else its presentation's own. */
async function putUpSlide(pin: Extract<QuickPin, { kind: 'slide' }>): Promise<void> {
  const doc = await window.drashti.library.getPresentation(pin.presentationId).catch(() => null);
  if (!doc) {
    gone(pin, 'in the library');
    return;
  }
  if (pin.playlistId !== null && pin.itemId !== null) {
    const { playlistId, itemId } = pin;
    const items = await window.drashti.playlists.items(playlistId).catch(() => []);
    const item = items.find((i) => i.id === itemId);
    if (item?.kind === 'presentation' && item.presentationId === pin.presentationId) {
      const order = itemOrder(item, doc);
      const at = order.slides.findIndex((s) => s.slide.id === pin.slideId);
      if (at >= 0) {
        await goLive(pin.presentationId, at, order.arrangementId, { playlistId, itemId });
        return;
      }
    }
  }
  const order = playOrder(doc, doc.selectedArrangementId);
  const at = order.slides.findIndex((s) => s.slide.id === pin.slideId);
  if (at < 0) {
    gone(pin, 'in its presentation');
    return;
  }
  await goLive(pin.presentationId, at, order.arrangementId, null);
}

/** A message's pin: shown as its Show does; one with words to fill in is shown from Messages. */
async function putUpMessage(pin: Extract<QuickPin, { kind: 'message' }>): Promise<void> {
  const templates = await window.drashti.messages.list().catch(() => []);
  const template = templates.find((t) => t.id === pin.templateId);
  if (!template) {
    gone(pin, 'in Messages');
    return;
  }
  const timers = useEngine.getState().state?.timers ?? [];
  const filled = fillMessage(template, {}, (id) => timers.find((t) => t.id === id)?.name ?? 'timer');
  if (!filled.message) {
    say(`“${template.name}” has words to fill in: show it from Messages.`);
    return;
  }
  await dispatch({ type: 'showMessage', message: filled.message });
}

async function putUp(pin: QuickPin): Promise<void> {
  switch (pin.kind) {
    case 'item':
      return playItem(pin.playlistId, pin.itemId);
    case 'slide':
      return putUpSlide(pin);
    case 'message':
      return putUpMessage(pin);
    case 'media':
      if (pin.media === 'audio')
        return dispatch({
          type: 'playAudio',
          audio: { id: pin.mediaId, title: pin.label, mediaId: pin.mediaId, volume: 1, loop: false },
        });
      // The picture instead of the slide, as a picture's row puts it up.
      if (useEngine.getState().state?.layers.slide) await dispatch({ type: 'clearLayer', layer: 'slide' });
      return dispatch({
        type: 'setBackground',
        background: { kind: 'media', mediaId: pin.mediaId, media: pin.media, fit: 'fit', loop: false },
      });
  }
}

/** The pin at `slot` (0 to 7) up, in turn with the show's other keys; nothing there, nothing happens. */
export function pressQuick(slot: number): Promise<void> {
  const pin = useQuickBar.getState().pins[slot];
  if (!pin) return Promise.resolve();
  return runInTurn(() => putUp(pin));
}
