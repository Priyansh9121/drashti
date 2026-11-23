import { useEffect, useRef, useState } from 'react';
import { slideCanvas } from '../../../shared/document-page';
import type { MadeSlidePlace, SlidePlace } from '../../../shared/page-part';
import type { CropRect, CropShape } from '../../../shared/picture-look';
import { FULL_CROP } from '../../../shared/picture-look';
import { renderEditedSlide } from '../../../shared/slide-design';
import type { EditDoc } from '../../../shared/slide-edit';
import { CropBox, cropForShape, CropShapes } from '../pictures/CropBox';
import { cropReadout } from '../pictures/crop-box';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { findSlide } from './ops';

/*
 * Make a slide… (alpha.21, the owner's "add a slide button to create a slide in drashti"): a PDF page as the editor has
 * it now, with the Picture editor's box over it (the whole page to begin with): drag it, its sides or corners, or use
 * the arrows; a shape keeps it 16:9 for the screens. Make the slide draws that part from the page itself at the hall's
 * picture size (main/library/pdf-editor.ts makeSlide), and keeps it as a presentation of one slide, in the open
 * playlist or the library only. The PDF's own slides are not changed; the operator window's Undo takes the slide away.
 */

const READOUT_ID = 'make-slide-readout';
/** The tallest the page is drawn here (CSS pixels): room for the choices and buttons in a 645-pixel-high window. */
const PAGE_HEIGHT = 280;

export interface MakeSlideBase {
  doc: EditDoc;
  slideId: string;
  stamp: string;
}

export function MakeSlideDialog({
  base,
  onClose,
  onMade,
}: {
  base: MakeSlideBase;
  onClose: () => void;
  /** What to say once it is made (the editor's note). */
  onMade: (said: string) => void;
}) {
  const slide = findSlide(base.doc, base.slideId);
  const canvas = slideCanvas(slide, base.doc);
  const [part, setPart] = useState<CropRect>(FULL_CROP);
  const [shape, setShape] = useState<CropShape>('free');
  const [place, setPlace] = useState<SlidePlace | null>(null);
  const [into, setInto] = useState<MadeSlidePlace>('playlist');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void window.drashti.slideEditor.slidePlace().then((now) => {
      if (!live) return;
      setPlace(now);
      if (!now.playlist) setInto('library');
    });
    return () => {
      live = false;
    };
  }, []);
  const playlist = place?.playlist ?? null;
  const choices: MadeSlidePlace[] = playlist ? ['playlist', 'library'] : ['library'];
  const make = async () => {
    if (busy || !slide) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await window.drashti.slideEditor.makeSlide({
        presentationId: base.doc.presentationId,
        doc: base.doc,
        stamp: base.stamp,
        slideId: base.slideId,
        part,
        place: into,
      });
      if (!made.ok) {
        setProblem(made.message);
        return;
      }
      onMade(
        made.playlist !== null
          ? `Made “${made.name}” in the playlist “${made.playlist}”. Undo in the operator window takes it away.`
          : `Made “${made.name}” in the library. Undo in the operator window takes it away.`,
      );
      onClose();
    } catch {
      setProblem('The slide could not be made. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };
  const label = (choice: MadeSlidePlace) =>
    choice === 'playlist' && playlist ? `The open playlist, “${playlist.name}”` : 'The library only';
  return (
    <Dialog
      title="Make a slide"
      subtitle="This page, or the part of it you drag out, as a slide of its own"
      size="md"
      testId="make-slide"
      onClose={busy ? null : onClose}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !slide || place === null} onClick={() => void make()}>
            {busy ? 'Making the slide…' : 'Make the slide'}
          </Button>
        </>
      }
    >
      <p className="mb-2 text-sm text-muted">
        Drag the frame, or its sides and corners, over the part to show. It is drawn from the page itself, as
        sharp as the hall’s screens show.
      </p>
      <div
        data-testid="make-slide-page"
        data-a11y-picture
        className="relative mx-auto touch-none rounded-md border border-line bg-black"
        style={{
          aspectRatio: `${String(canvas.width)} / ${String(canvas.height)}`,
          width: `min(100%, ${String(Math.round((PAGE_HEIGHT * canvas.width) / canvas.height))}px)`,
        }}
      >
        {slide && (
          <PlacedInParent
            fractional
            content={canvas}
            mode="fit"
            className="pointer-events-none absolute inset-0"
          >
            <SlideView slide={renderEditedSlide(base.doc, slide)} media="still" />
          </PlacedInParent>
        )}
        <div ref={area} className="absolute inset-0">
          <CropBox
            frame={area}
            picture={{ left: 0, top: 0, width: 100, height: 100 }}
            crop={part}
            change={setPart}
            shape={shape}
            turned={canvas}
            testId="make-slide-box"
            describedBy={READOUT_ID}
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CropShapes
          shape={shape}
          choose={(next) => {
            setShape(next);
            setPart((was) => cropForShape(next, canvas, was));
          }}
          testId="make-slide-shapes"
          idPrefix="make-slide-shape"
        />
        <Button
          size="sm"
          onClick={() => {
            setShape('free');
            setPart(FULL_CROP);
          }}
        >
          The whole page
        </Button>
        <p id={READOUT_ID} className="text-xs text-muted tabular-nums" data-testid="crop-readout">
          {cropReadout(part)}
        </p>
      </div>
      <div className="mt-3">
        <p id="make-slide-into" className="mb-1 text-sm font-medium text-fg">
          Put it in
        </p>
        <div
          role="radiogroup"
          aria-labelledby="make-slide-into"
          className="flex flex-wrap gap-2"
          onKeyDown={radioKeys(choices, into, setInto)}
        >
          {choices.map((choice, i) => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={into === choice}
              tabIndex={radioTabIndex(into === choice, i, true)}
              data-testid={`make-slide-${choice}`}
              className={`rounded-md border px-2.5 py-1 text-sm ${into === choice ? 'border-primary bg-primary text-on-primary' : 'border-line text-fg hover:bg-panel-3'}`}
              onClick={() => {
                setInto(choice);
              }}
            >
              {label(choice)}
            </button>
          ))}
        </div>
        {place !== null && !playlist && (
          <p className="mt-1 text-xs text-muted">
            No playlist is open in the operator window: the slide goes into the library.
          </p>
        )}
      </div>
      {problem && (
        <p role="alert" className="mt-2 text-sm text-danger-fg" data-testid="make-slide-problem">
          {problem}
        </p>
      )}
    </Dialog>
  );
}
