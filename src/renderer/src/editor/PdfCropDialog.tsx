import { useRef, useState } from 'react';
import { slideCanvas } from '../../../shared/document-page';
import type { CropRect, CropShape } from '../../../shared/picture-look';
import { FULL_CROP } from '../../../shared/picture-look';
import { PDF_CROP_WAIT } from '../../../shared/pdf-work';
import { renderEditedSlide } from '../../../shared/slide-design';
import type { EditDoc } from '../../../shared/slide-edit';
import { CropBox, CropShapes, cropForShape } from '../pictures/CropBox';
import { cropReadout } from '../pictures/crop-box';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select } from '../ui/Field';
import { findSlide } from './ops';
import { cropPdfPages, type PdfCropPages } from './pdf-crop';

const SCOPES = [
  ['this', 'This page'],
  ['every', 'Every page'],
  ['odd', 'Odd pages'],
  ['even', 'Even pages'],
] as const;
export function PdfCropDialog({
  doc,
  slideId,
  offAir,
  onClose,
  onKeep,
}: {
  doc: EditDoc;
  slideId: string;
  offAir: boolean;
  onClose: () => void;
  onKeep: (next: EditDoc) => Promise<boolean>;
}) {
  const slide = findSlide(doc, slideId);
  const canvas = slideCanvas(slide, doc);
  const [crop, setCrop] = useState<CropRect>(slide?.documentPage?.crop ?? FULL_CROP);
  const [shape, setShape] = useState<CropShape>('free');
  const [pages, setPages] = useState<PdfCropPages>('this');
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const blocked = busy || !offAir;
  return (
    <Dialog
      title="Crop page"
      subtitle="Show only the part you choose"
      testId="pdf-crop-dialog"
      size="md"
      onClose={busy ? null : onClose}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={blocked || !slide}
            onClick={() => {
              setBusy(true);
              void onKeep(cropPdfPages(doc, slideId, crop, pages))
                .then((kept) => {
                  if (kept) onClose();
                })
                .finally(() => setBusy(false));
            }}
          >
            Keep crop
          </Button>
        </>
      }
    >
      <p className="mb-2 text-sm text-muted">
        Drag the frame, its sides or corners over the part to show. The arrows move it; Shift and the arrows
        change its size. The whole page stays underneath.
      </p>
      <fieldset disabled={blocked} className="min-w-0">
        <legend className="sr-only">Page crop</legend>
        <div
          data-testid="pdf-crop-page"
          data-a11y-picture
          className={`relative mx-auto touch-none rounded-md border border-line bg-black ${blocked ? 'pointer-events-none' : ''}`}
          style={{
            aspectRatio: `${String(canvas.width)} / ${String(canvas.height)}`,
            width: `min(100%, ${String(Math.round((260 * canvas.width) / canvas.height))}px)`,
          }}
        >
          {slide && (
            <PlacedInParent
              fractional
              content={canvas}
              mode="fit"
              className="pointer-events-none absolute inset-0"
            >
              <SlideView slide={renderEditedSlide(doc, slide, true)} media="still" />
            </PlacedInParent>
          )}
          <div ref={area} className="absolute inset-0">
            <CropBox
              frame={area}
              picture={{ left: 0, top: 0, width: 100, height: 100 }}
              crop={crop}
              change={(next) => {
                if (!blocked) setCrop(next);
              }}
              shape={shape}
              turned={canvas}
              testId="pdf-crop-box"
              describedBy="pdf-crop-readout"
            />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <CropShapes
            shape={shape}
            choose={(next) => {
              if (blocked) return;
              setShape(next);
              setCrop((was) => cropForShape(next, canvas, was));
            }}
            testId="pdf-crop-shapes"
            idPrefix="pdf-crop-shape"
          />
          <Button
            size="sm"
            onClick={() => {
              setShape('free');
              setCrop(FULL_CROP);
            }}
          >
            The whole page
          </Button>
          <p id="pdf-crop-readout" data-testid="crop-readout" className="text-xs text-muted tabular-nums">
            {cropReadout(crop)}
          </p>
        </div>
        <div className="mt-3">
          <Field label="Apply to">
            <Select
              value={pages}
              onChange={(e) => {
                const scope = SCOPES.find(([value]) => value === e.target.value);
                if (scope) setPages(scope[0]);
              }}
            >
              {SCOPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="mt-2 text-xs text-muted">
          Odd and even follow the page order here. Save keeps this crop in the library. Undo restores the
          previous crop.
        </p>
      </fieldset>
      {!offAir && (
        <p role="status" className="mt-2 text-sm text-muted">
          {PDF_CROP_WAIT}
        </p>
      )}
    </Dialog>
  );
}
