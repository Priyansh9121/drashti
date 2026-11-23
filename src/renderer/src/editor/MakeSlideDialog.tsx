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
import { Field, Select } from '../ui/Field';
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
  const pages = base.doc.groups.flatMap((g) => g.slides).filter((s) => s.documentPage?.ext === 'pdf');
  const [slideId, setSlideId] = useState(base.slideId);
  const [parts, setParts] = useState<{ id: number; slideId: string; part: CropRect }[]>([]);
  const nextPart = useRef(1);
  const dragging = useRef<number | null>(null);
  const slide = findSlide(base.doc, slideId);
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
  const add = () => {
    if (busy || !slide || parts.length >= 400) return;
    const picked = { id: nextPart.current++, slideId, part: { ...part } };
    setParts((was) => [...was, picked]);
  };
  const reorder = (from: number, to: number) => {
    setParts((was) => {
      const next = [...was];
      const [picked] = next.splice(from, 1);
      if (picked) next.splice(to, 0, picked);
      return next;
    });
  };
  const playlist = place?.playlist ?? null;
  const choices: MadeSlidePlace[] = playlist ? ['playlist', 'library'] : ['library'];
  const make = async () => {
    if (busy || !slide || place === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await window.drashti.slideEditor.makeSlide({
        presentationId: base.doc.presentationId,
        doc: base.doc,
        stamp: base.stamp,
        slideId,
        ...(parts.length ? { parts: parts.map(({ slideId, part }) => ({ slideId, part })) } : {}),
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
      subtitle="This page, or parts collected across pages, as slides of their own"
      size="md"
      testId="make-slide"
      onClose={busy ? null : onClose}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !slide || place === null} onClick={() => void make()}>
            {busy
              ? 'Making the slides…'
              : parts.length
                ? `Make ${String(parts.length)} slides`
                : 'Make the slide'}
          </Button>
        </>
      }
    >
      <p className="mb-2 text-sm text-muted">
        Drag the frame, or its sides and corners, over the part to show. It is drawn from the page itself, as
        sharp as the hall’s screens show.
      </p>
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <Field label="PDF page">
          <Select
            value={slideId}
            disabled={busy}
            onChange={(e) => {
              setSlideId(e.target.value);
              setPart(FULL_CROP);
              setShape('free');
            }}
          >
            {pages.map((page, i) => (
              <option key={page.id} value={page.id}>
                Page {i + 1}
              </option>
            ))}
          </Select>
        </Field>
        <Button disabled={busy || !slide || parts.length >= 400} onClick={add}>
          Add this part
        </Button>
        <p role="status" className="text-xs text-muted">
          {parts.length ? `${String(parts.length)} parts collected` : 'Enter on the frame adds this part.'}
        </p>
      </div>
      <div
        data-testid="make-slide-page"
        data-a11y-picture
        aria-disabled={busy}
        className={`relative mx-auto touch-none rounded-md border border-line bg-black ${busy ? 'pointer-events-none' : ''}`}
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
        <div
          ref={area}
          className="absolute inset-0"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.repeat) {
              e.preventDefault();
              e.stopPropagation();
              add();
            }
          }}
        >
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
      {parts.length > 0 && (
        <section aria-label="Collected parts" className="mt-3">
          <p className="mb-1 text-xs text-muted">
            Drag parts into reading order, or use Move earlier and Move later. Up to 400 parts.
          </p>
          <ol className="max-h-40 space-y-1 overflow-y-auto" aria-label="Parts in reading order">
            {parts.map((picked, index) => {
              const page = findSlide(base.doc, picked.slideId);
              if (!page) return null;
              const number = pages.findIndex((p) => p.id === picked.slideId) + 1;
              return (
                <li
                  key={picked.id}
                  data-testid="collected-part"
                  className="flex flex-wrap items-center gap-2 rounded-md border border-line p-1.5"
                  onDragOver={(e) => {
                    if (!busy && dragging.current !== null) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = parts.findIndex((p) => p.id === dragging.current);
                    if (!busy && from >= 0) reorder(from, index);
                    dragging.current = null;
                  }}
                >
                  <button
                    type="button"
                    draggable={!busy}
                    disabled={busy}
                    aria-label={`Drag part ${String(index + 1)}`}
                    title="Drag to reorder"
                    onDragStart={(e) => {
                      dragging.current = picked.id;
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(picked.id));
                    }}
                    onDragEnd={() => {
                      dragging.current = null;
                    }}
                    className="shrink-0 cursor-grab rounded border border-line bg-black"
                  >
                    <PartPreview doc={base.doc} slideId={picked.slideId} part={picked.part} />
                  </button>
                  <span className="min-w-0 flex-1 text-xs">
                    Part {index + 1} · Page {number}
                    <span className="block text-muted">{cropReadout(picked.part)}</span>
                  </span>
                  <Button
                    size="sm"
                    aria-label={`Move part ${String(index + 1)} earlier`}
                    disabled={busy || index === 0}
                    onClick={() => reorder(index, index - 1)}
                  >
                    Move earlier
                  </Button>
                  <Button
                    size="sm"
                    aria-label={`Move part ${String(index + 1)} later`}
                    disabled={busy || index === parts.length - 1}
                    onClick={() => reorder(index, index + 1)}
                  >
                    Move later
                  </Button>
                  <Button
                    size="sm"
                    aria-label={`Remove part ${String(index + 1)}`}
                    disabled={busy}
                    onClick={() => setParts((was) => was.filter((p) => p.id !== picked.id))}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ol>
        </section>
      )}
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

/** The collected part as it will look, clipped from the edited page, without the crop handles. */
function PartPreview({ doc, slideId, part }: { doc: EditDoc; slideId: string; part: CropRect }) {
  const slide = findSlide(doc, slideId);
  if (!slide) return null;
  const canvas = slideCanvas(slide, doc);
  const scale = Math.min(80 / (canvas.width * part.w), 56 / (canvas.height * part.h));
  return (
    <span
      data-a11y-picture
      className="pointer-events-none relative block overflow-hidden"
      style={{ width: canvas.width * part.w * scale, height: canvas.height * part.h * scale }}
    >
      <span
        className="absolute block"
        style={{
          width: `${String(100 / part.w)}%`,
          height: `${String(100 / part.h)}%`,
          left: `${String((-100 * part.x) / part.w)}%`,
          top: `${String((-100 * part.y) / part.h)}%`,
        }}
      >
        <PlacedInParent fractional content={canvas} mode="fit" className="absolute inset-0">
          <SlideView slide={renderEditedSlide(doc, slide)} media="still" />
        </PlacedInParent>
      </span>
    </span>
  );
}
