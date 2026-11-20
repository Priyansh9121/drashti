import type { NewPresentation } from '../db/presentations';
import { cutText } from '../../shared/text';
import type { MediaElement, TextElement } from '../../shared/model';
import { lookText, type NewSlideLook } from './words';

export { QR_TEXT_MAX, qrWords } from '../../shared/qr-picture';

/*
 * The QR-code slide (Session 55, Part 8, the owner's idea G): New › QR code… makes, from a link or words pasted, one
 * slide with a large code in the middle and the words under it. Made here, offline, with the QR encoder Drashti already
 * has for pairing phones (uqr, MIT): the code becomes a PNG picture in the library (black on white with its quiet
 * border, about 1080 pixels square, so a phone reads it from the back of the hall), and the slide holds it. Since
 * alpha.20 (Q60-28) the picture is made in the QR worker and read back first (qr-maker.ts), with the logo in the middle
 * when the window asks, and the words under the code are the window's choice: without them, the code alone, larger.
 */

/** Its name in the library: "QR code: " and its words on one line, cut on a letter. */
export function qrSlideName(text: string): string {
  return `QR code: ${cutText(text.trim().replace(/\s+/gu, ' '), 71, '…')}`;
}

const W = 1920;
const H = 1080;
/** The code's side on the slide, and the space above it and between it and the words. */
const CODE = 720;
const TOP = 72;
const GAP = 24;
/** The code's side on a slide without its words: all but the space above and below it, in the middle. */
const CODE_ALONE = H - 2 * TOP;

/**
 * One slide: the code large in the middle, the words under it in the look a new slide has (centred, shrinking to fit);
 * without its words (`withWords` false), the code alone, larger, in the middle.
 */
export function qrSlidePresentation(
  libraryId: string,
  name: string,
  text: string,
  mediaId: string,
  look: NewSlideLook,
  withWords = true,
): NewPresentation & { width: number; height: number } {
  const words = text.trim();
  const side = withWords ? CODE : CODE_ALONE;
  const code: MediaElement = {
    id: 'qr',
    kind: 'image',
    frame: { x: (W - side) / 2, y: TOP, width: side, height: side },
    mediaId,
    fit: 'fit',
  };
  const below = TOP + CODE + GAP;
  const props = lookText([words], look);
  const caption: TextElement = {
    id: 'text',
    kind: 'text',
    frame: { x: 120, y: below, width: W - 240, height: H - below - 48 },
    ...props,
    style: { ...props.style, fontSize: 56, align: 'center', verticalAlign: 'top', shrinkToFit: true },
  };
  return {
    libraryId,
    name,
    width: W,
    height: H,
    groups: [
      {
        name: '',
        color: null,
        slides: [{ elements: withWords ? [code, caption] : [code], background: look.background }],
      },
    ],
    arrangements: [],
    selectedArrangement: null,
    source: { kind: 'drashti', path: null, ref: null, importedAt: null },
  };
}
