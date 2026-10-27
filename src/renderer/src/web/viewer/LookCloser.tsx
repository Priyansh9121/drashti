import { stepOf } from '../../../../shared/deck-show';
import type { OrderedSlide } from '../../../../shared/order';
import { useEngine } from '../../engine/engine-store';
import { Button, IconButton } from '../../ui/Button';
import { GalleryHorizontalEnd, Play, ZoomIn } from '../../ui/icons';
import { picturePage, presentationPages, screensPage, videoPage } from './pages';
import { openViewer } from './viewer-store';

/*
 * Where the remote opens the viewer (Session 54, D1): the live picture (Look closer beside its heading, or a tap on
 * the picture itself), a presentation's slides (Look through: its pages, a deck's or a PDF's, one by one), and a
 * picture or a video in the playlist (looked at, or played, on this device only).
 */

const openScreens = () => {
  openViewer([screensPage()]);
};

/** Beside "On the screens": their picture, larger and sharp, zoomed on this device (and, D2, put on the screens). */
export function LookCloser() {
  return (
    <Button size="lg" icon={ZoomIn} data-testid="remote-look-closer" onClick={openScreens}>
      Look closer
    </Button>
  );
}

/**
 * Over the live picture, which is hidden from screen readers: a tap opens it too (Look closer above it is the way
 * for the keyboard and a screen reader).
 */
export function LookOverlay() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 cursor-zoom-in"
      data-testid="remote-live-look"
      onClick={openScreens}
    />
  );
}

/**
 * Over a presentation's slides: looked through on this device, from the one on the screens (at the click the screens
 * show, a deck's) or the one found; a deck's slide a page for each click (D1/D2 review).
 */
export function LookThrough({
  presentationId,
  name,
  slides,
  from,
}: {
  presentationId: string;
  name: string;
  slides: readonly OrderedSlide[];
  /** The place in the order to start at. */
  from: number;
}) {
  return (
    <Button
      size="lg"
      icon={GalleryHorizontalEnd}
      data-testid="remote-look-through"
      disabled={slides.length === 0}
      onClick={() => {
        const up = useEngine.getState().state?.layers.slide;
        const step = up?.presentationId === presentationId && up.slideIndex === from ? stepOf(up) : null;
        const { pages, start } = presentationPages(presentationId, slides, from, step);
        openViewer(pages, start, name);
      }}
    >
      Look through
    </Button>
  );
}

/** Beside a picture or a video in the playlist: looked at, or played, on this device only. */
export function LookAtMedia({
  mediaId,
  media,
  name,
}: {
  mediaId: string;
  media: 'image' | 'video';
  name: string;
}) {
  const video = media === 'video';
  return (
    <IconButton
      icon={video ? Play : ZoomIn}
      label={video ? `Play “${name}” on this device` : `Look at “${name}” on this device`}
      size="lg"
      variant="secondary"
      className="min-h-12 min-w-12"
      data-testid="remote-item-look"
      onClick={() => {
        openViewer([video ? videoPage(mediaId, name) : picturePage(mediaId, name)]);
      }}
    />
  );
}
