import { useEffect } from 'react';
import type { PresentationDoc } from '../../../../shared/library';
import { playOrder } from '../../../../shared/order';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import { pinKey, type QuickPin } from '../../../../shared/quick-bar';
import { itemOrder } from '../../playlists/rows';
import type { Icon } from '../../ui/icons';
import {
  ArrowLeft,
  ArrowRight,
  Image,
  MessageSquare,
  Music,
  PinOff,
  Presentation,
  Video,
} from '../../ui/icons';
import { type ApiAnswer, api } from '../device';
import { tap } from '../taps';
import { longPressProps } from './long-press';
import { loadPins, movePin, openMenu, unpin, usePhoneTools } from './phone-tools-store';
import { useSimple } from './simple';

/*
 * The quick bar on a phone or tablet (Session 55, Part 9, from Part 8): the window's pins (up to 8), just above the
 * clears as the window has them above its bar of clears, one tap each, doing what the window's press does, through the
 * phone's own requests: a playlist's row as a tap on the row puts it up, a slide's row from its row (found by its slide
 * wherever it is now in the order its row plays), a picture or video from Media as the picture, a sound as the sound,
 * and a message as its Show does. Something gone since it was pinned says so. A pin's long press: Move left, Move
 * right, Unpin. Pinned from a row's long press (row-actions.ts). Hidden when empty, and in Simple Mode (its window has
 * none).
 */

const post = (path: string, body: Record<string, unknown> = {}) =>
  api<{ rev?: number }>(path, { method: 'POST', body });

/** Said as the window says it: something pinned is gone. */
const gone = (pin: QuickPin, where: string): ApiAnswer<{ rev?: number }> => ({
  ok: false,
  status: 404,
  message: `“${pin.label}” is no longer ${where}: a long press on it on the quick bar takes it off.`,
});

/** A slide's pin: from its row, found by its slide in the order the row plays now; else its presentation's own. */
async function slideUp(pin: Extract<QuickPin, { kind: 'slide' }>): Promise<ApiAnswer<{ rev?: number }>> {
  const read = await api<{ presentation: PresentationDoc }>(
    `/api/v1/presentations/${encodeURIComponent(pin.presentationId)}`,
  );
  if (!read.ok) return gone(pin, 'in the library');
  const doc = read.presentation;
  if (pin.playlistId !== null && pin.itemId !== null) {
    const listed = await api<{ items: PlaylistItemInfo[] }>(
      `/api/v1/playlists/${encodeURIComponent(pin.playlistId)}/items`,
    );
    const item = listed.ok ? listed.items.find((i) => i.id === pin.itemId) : undefined;
    if (item?.kind === 'presentation' && item.presentationId === pin.presentationId) {
      const order = itemOrder(item, doc);
      const at = order.slides.findIndex((s) => s.slide.id === pin.slideId);
      if (at >= 0)
        return post('/api/v1/trigger/slide', {
          presentationId: pin.presentationId,
          slideIndex: at,
          arrangementId: order.arrangementId,
          playlist: { playlistId: pin.playlistId, itemId: pin.itemId },
        });
    }
  }
  const order = playOrder(doc, doc.selectedArrangementId);
  const at = order.slides.findIndex((s) => s.slide.id === pin.slideId);
  if (at < 0) return gone(pin, 'in its presentation');
  return post('/api/v1/trigger/slide', {
    presentationId: pin.presentationId,
    slideIndex: at,
    arrangementId: order.arrangementId,
    playlist: null,
  });
}

/** One tap on a pin: what the window's press does. */
function pressed(pin: QuickPin): Promise<ApiAnswer<{ rev?: number }>> {
  switch (pin.kind) {
    case 'item':
      return post('/api/v1/trigger/item', { playlistId: pin.playlistId, itemId: pin.itemId });
    case 'slide':
      return slideUp(pin);
    case 'media':
      // A picture or video instead of the slide, a sound as the sound (Media's own put-up).
      return post(`/api/v1/media/${encodeURIComponent(pin.mediaId)}/show`);
    case 'message':
      // Shown as its Show does; one with words to fill in says so (show it from Messages).
      return post(`/api/v1/messages/${encodeURIComponent(pin.templateId)}/show`, { values: {} });
  }
}

const ICON: Record<QuickPin['kind'], Icon> = {
  slide: Presentation,
  item: Presentation,
  media: Image,
  message: MessageSquare,
};

function pinIcon(pin: QuickPin): Icon {
  if (pin.kind === 'media') return pin.media === 'audio' ? Music : pin.media === 'video' ? Video : Image;
  if (pin.kind === 'item')
    return pin.what === 'sound'
      ? Music
      : pin.what === 'video' || pin.what === 'input'
        ? Video
        : pin.what === 'picture'
          ? Image
          : Presentation;
  return ICON[pin.kind];
}

export function QuickBar() {
  const pins = usePhoneTools((s) => s.pins);
  const simple = useSimple();
  useEffect(() => {
    void loadPins();
  }, []);
  if (simple || pins.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Quick bar"
      className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2"
      data-testid="remote-quick-bar"
    >
      {pins.map((pin, i) => {
        const PinIcon = pinIcon(pin);
        const key = pinKey(pin);
        return (
          <button
            key={key}
            type="button"
            data-testid="remote-quick-pin"
            onClick={() => void tap(() => pressed(pin))}
            {...longPressProps(() => {
              openMenu(pin.label, [
                ...(i > 0
                  ? [{ id: 'left', label: 'Move left', icon: ArrowLeft, run: () => void movePin(key, -1) }]
                  : []),
                ...(i < pins.length - 1
                  ? [{ id: 'right', label: 'Move right', icon: ArrowRight, run: () => void movePin(key, 1) }]
                  : []),
                {
                  id: 'unpin',
                  label: 'Unpin from the quick bar',
                  icon: PinOff,
                  run: () => void unpin(key),
                },
              ]);
            })}
            className="flex min-h-12 min-w-0 items-center gap-2 rounded-lg border border-line-strong bg-panel-2 px-3 py-1.5 text-left text-base text-fg select-none [-webkit-touch-callout:none]"
          >
            <PinIcon size={18} aria-hidden="true" className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate" translate="no">
              {pin.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
