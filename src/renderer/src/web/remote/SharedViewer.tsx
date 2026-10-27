import { useEffect, useRef, useState } from 'react';
import { backgroundCueOf, type PresentationDoc } from '../../../../shared/library';
import { playOrder } from '../../../../shared/order';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import { PlacedInParent } from '../../render/Placed';
import { PreviewPicture } from '../../render/previews';
import { SlideView } from '../../render/SlideView';
import { Button } from '../../ui/Button';
import { useFocusTrap } from '../../ui/Dialog';
import { ChevronLeft, ChevronRight, X } from '../../ui/icons';
import { api } from '../device';
import { closeViewer, stepViewer, usePhoneFiles } from './phone-files-store';
import { DevicePicture, DevicePlayer } from './shared-media';

/*
 * A shared playlist's file, looked at on this device (Session 54, D3): a picture as large as the screen allows, a
 * video or a sound played here, a presentation's slides (a deck's or a PDF's pages among them) one under another.
 * Read-only, and on this device only: nothing here goes on the screens. Previous file and Next file step through the
 * playlist's files; Close (or Esc) goes back to the list.
 */

/** What an item is, in a word. */
export function itemWord(item: PlaylistItemInfo): string {
  switch (item.kind) {
    case 'media':
      return item.media === 'image' ? 'Picture' : item.media === 'video' ? 'Video' : 'Sound';
    case 'presentation':
      return item.deck ? 'Deck' : 'Presentation';
    case 'shastra':
      return 'Shastra passage';
    case 'input':
      return 'Video input';
    case 'placeholder':
      return 'Empty';
    case 'header':
      return 'Header';
  }
}

/** Whether an item can be looked at on a phone: a file that is there, or a presentation's slides. */
export const viewable = (item: PlaylistItemInfo): boolean =>
  (item.kind === 'media' && !item.missing) ||
  (item.kind === 'presentation' && item.presentationName !== null) ||
  (item.kind === 'shastra' && !item.missing);

/** A presentation's slides in the item's order, one under another, each as large as the width allows. */
function Slides({ item }: { item: Extract<PlaylistItemInfo, { kind: 'presentation' | 'shastra' }> }) {
  const id = item.kind === 'presentation' ? item.presentationId : item.passageId;
  // What was read, for the presentation it was read for (another one opens as "Opening…" until it is read).
  const [read, setRead] = useState<{ id: string; doc: PresentationDoc | 'gone' } | null>(null);
  useEffect(() => {
    let live = true;
    void api<{ presentation: PresentationDoc }>(`/api/v1/presentations/${encodeURIComponent(id)}`).then(
      (r) => {
        if (live) setRead({ id, doc: r.ok ? r.presentation : 'gone' });
      },
    );
    return () => {
      live = false;
    };
  }, [id]);
  const doc = read?.id === id ? read.doc : null;
  if (doc === null)
    return (
      <p role="status" className="p-4 text-base text-muted">
        Opening…
      </p>
    );
  if (doc === 'gone') return <p className="p-4 text-base text-muted">Drashti could not open it.</p>;
  const order =
    item.kind === 'presentation' && item.order.mode === 'arrangement'
      ? item.order.arrangementId
      : item.kind === 'presentation' && item.order.mode === 'presentation'
        ? doc.selectedArrangementId
        : null;
  const slides = playOrder(doc, order).slides;
  return (
    <ol className="space-y-3 p-3" aria-label="Its slides" data-testid="shared-slides">
      {slides.map((s) => {
        const bg = backgroundCueOf(s.slide.cues);
        const { width, height } = s.slide.slide;
        return (
          <li key={s.position} aria-label={`Slide ${String(s.position + 1)} of ${String(slides.length)}`}>
            <div
              className="relative w-full bg-black"
              style={{ aspectRatio: `${String(width)} / ${String(height)}` }}
              data-a11y-picture
              aria-hidden="true"
            >
              <PlacedInParent content={{ width, height }} mode="fit" className="absolute inset-0">
                <div style={{ position: 'relative', width, height }}>
                  {bg?.background.kind === 'media' && (
                    <PreviewPicture
                      mediaId={bg.background.mediaId}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                  )}
                  <div style={{ position: 'absolute', inset: 0 }}>
                    <SlideView slide={s.slide.slide} media="still" />
                  </div>
                </div>
              </PlacedInParent>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Shown({ item }: { item: PlaylistItemInfo }) {
  if (item.kind === 'media')
    return (
      <div className="relative h-full min-h-64 bg-black" data-testid="shared-media" data-media={item.media}>
        {item.media === 'image' ? (
          <DevicePicture mediaId={item.mediaId} />
        ) : (
          <DevicePlayer mediaId={item.mediaId} kind={item.media} label={item.label} />
        )}
      </div>
    );
  if (item.kind === 'presentation' || item.kind === 'shastra') return <Slides item={item} />;
  return null;
}

export function SharedViewer() {
  const viewing = usePhoneFiles((s) => s.viewing);
  if (!viewing) return null;
  const item = viewing.items[viewing.index];
  if (!item) return null;
  return <Viewer item={item} index={viewing.index} count={viewing.items.length} />;
}

function Viewer({ item, index, count }: { item: PlaylistItemInfo; index: number; count: number }) {
  const root = useRef<HTMLDivElement>(null);
  useFocusTrap(root, closeViewer);
  const scroller = useRef<HTMLDivElement>(null);
  // Each file from its top.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [item.id]);
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shared-viewer-title"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-ink"
      data-testid="shared-viewer"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="shared-viewer-title" className="truncate text-base font-bold text-fg">
            {item.label}
          </h2>
          <p className="text-base text-muted" data-testid="shared-viewer-where">
            {itemWord(item)} · {String(index + 1)} of {String(count)}
          </p>
        </div>
        <Button
          size="lg"
          icon={X}
          className="min-h-12"
          onClick={closeViewer}
          data-testid="shared-viewer-close"
        >
          Close
        </Button>
      </header>
      {/* Focusable, so the keyboard scrolls a long presentation too. */}
      <div
        ref={scroller}
        role="region"
        aria-label={item.label}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto bg-black"
      >
        <Shown item={item} />
      </div>
      <footer className="shrink-0 border-t border-line bg-panel px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <p className="pb-3 text-base text-muted">On this device only: nothing here goes on the screens.</p>
        <div className="grid grid-cols-2 gap-3">
          <Button
            size="lg"
            icon={ChevronLeft}
            className="min-h-12"
            disabled={index === 0}
            onClick={() => {
              stepViewer(-1);
            }}
            data-testid="shared-viewer-previous"
          >
            Previous file
          </Button>
          <Button
            size="lg"
            iconEnd={ChevronRight}
            className="min-h-12"
            disabled={index === count - 1}
            onClick={() => {
              stepViewer(1);
            }}
            data-testid="shared-viewer-next"
          >
            Next file
          </Button>
        </div>
      </footer>
    </div>
  );
}
