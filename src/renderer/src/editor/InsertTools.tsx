import { slideCanvas } from '../../../shared/document-page';
import { useRef, useState } from 'react';
import type { MediaElement, Rect } from '../../../shared/model';
import type { CropRect, CropShape } from '../../../shared/picture-look';
import { CropBox, cropForShape, CropShapes } from '../pictures/CropBox';
import { cropReadout, keptCrop, shownCrop } from '../pictures/crop-box';
import { PlacedInParent } from '../render/Placed';
import { ElementView } from '../render/SlideView';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, NumberInput } from '../ui/Field';
import { Check, Crop, Heart, Music, Shapes, Star, Table2 } from '../ui/icons';
import { Menu, type MenuPlace } from '../ui/Menu';
import { commit, currentLook, useEditor } from './editor-store';
import { addElement, findSlide, mapElements } from './ops';
import type { ShapeChoice } from './ops';
import { tableElements } from './arrange-ops';
import { Cluster } from './RibbonParts';
import { finishTextEditing } from './TextBoxEditor';

/** Changing a crop changes its frame by the same ratio, preserving the picture's scale and the frame's centre. */
export function croppedElement(el: MediaElement, crop: Rect | undefined): MediaElement {
  const old = el.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const width = (el.frame.width / old.width) * (crop?.width ?? 1);
  const height = (el.frame.height / old.height) * (crop?.height ?? 1);
  const { crop: _old, ...rest } = el;
  return {
    ...rest,
    ...(crop ? { crop } : {}),
    frame: {
      ...el.frame,
      x: el.frame.x + (el.frame.width - width) / 2,
      y: el.frame.y + (el.frame.height - height) / 2,
      width,
      height,
    },
  };
}

export function InsertTools({
  addShape,
  onSound,
}: {
  addShape: (choice: ShapeChoice) => void;
  onSound: () => void;
}) {
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.slideId);
  const selection = useEditor((s) => s.selection);
  const slide = doc ? findSlide(doc, slideId) : undefined;
  const selected = selection.length === 1 ? slide?.elements.find((el) => el.id === selection[0]) : undefined;
  const [table, setTable] = useState(false);
  const [crop, setCrop] = useState(false);
  const [icons, setIcons] = useState<MenuPlace | null>(null);
  return (
    <>
      <Cluster name="More to add">
        <Button
          size="sm"
          variant="ghost"
          icon={Music}
          data-testid="add-sound"
          disabled={!slide || doc?.master?.id === slide.id}
          onClick={() => {
            finishTextEditing();
            onSound();
          }}
        >
          Sound
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={Table2}
          data-testid="add-table"
          disabled={!slide}
          onClick={() => {
            finishTextEditing();
            setTable(true);
          }}
        >
          Table
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={Shapes}
          data-testid="add-icon"
          disabled={!slide}
          aria-haspopup="menu"
          onClick={(e) => {
            finishTextEditing();
            const r = e.currentTarget.getBoundingClientRect();
            setIcons({ x: r.left, y: r.bottom + 4 });
          }}
        >
          Icon
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={Crop}
          data-testid="crop-picture"
          disabled={selected?.kind !== 'image'}
          onClick={() => {
            finishTextEditing();
            setCrop(true);
          }}
        >
          Crop picture
        </Button>
      </Cluster>
      {icons && (
        <Menu
          at={icons}
          label="Add an icon"
          onClose={() => setIcons(null)}
          entries={(
            [
              ['star', 'Star', Star],
              ['heart', 'Heart', Heart],
              ['check', 'Check mark', Check],
            ] as const
          ).map(([choice, label, icon]) => ({ label, icon, onSelect: () => addShape(choice) }))}
        />
      )}
      {table && <TableDialog onClose={() => setTable(false)} />}
      {crop && selected?.kind === 'image' && slide && (
        <CropDialog el={selected} slideId={slide.id} onClose={() => setCrop(false)} />
      )}
    </>
  );
}

function TableDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  const valid =
    Number.isInteger(rows) &&
    Number.isInteger(columns) &&
    rows >= 1 &&
    rows <= 10 &&
    columns >= 1 &&
    columns <= 10;
  const add = () => {
    const s = useEditor.getState();
    const look = currentLook();
    if (!s.doc || !look || !s.slideId || !valid) return;
    const cells = tableElements(rows, columns, look, slideCanvas(findSlide(s.doc, s.slideId), s.doc));
    let doc = s.doc;
    for (const cell of cells) doc = addElement(doc, s.slideId, cell);
    commit(doc, { select: cells.map((el) => el.id) });
    onClose();
  };
  return (
    <Dialog
      title="Add a table"
      size="sm"
      testId="insert-table"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={add} disabled={!valid}>
            Add table
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        Double-click a cell to write. The cells move together; Ungroup lets you change their places.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rows">
          <NumberInput
            aria-label="Rows"
            data-testid="table-rows"
            min={1}
            max={10}
            value={rows}
            onChange={(e) => setRows(Number(e.target.value))}
          />
        </Field>
        <Field label="Columns">
          <NumberInput
            aria-label="Columns"
            data-testid="table-columns"
            min={1}
            max={10}
            value={columns}
            onChange={(e) => setColumns(Number(e.target.value))}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/** Its read-out's id, for the box's screen-reader description. */
const CROP_READOUT_ID = 'slide-crop-readout';

/**
 * Crop only this slide's picture (alpha.21, the owner's "physical way to crop, like in a photo"): the Picture editor's
 * box dragged over the whole picture as the slide draws it (its library look and its flips too), its sides, corners
 * or the arrows; the four sides' numbers only as a read-out. Other slides keep their picture.
 */
function CropDialog({ el, slideId, onClose }: { el: MediaElement; slideId: string; onClose: () => void }) {
  const old = el.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  // The picture's whole frame before this slide's crop: the box is dragged over all of it.
  const whole = { width: el.frame.width / old.width, height: el.frame.height / old.height };
  const [crop, setCrop] = useState<CropRect>(() => shownCrop(el.crop, el.flipX, el.flipY));
  const [shape, setShape] = useState<CropShape>('free');
  const area = useRef<HTMLDivElement>(null);
  // As the slide draws it, uncropped and upright (its own turn is the slide's, after the crop), in the dialog's box.
  const { crop: _crop, rotation: _turn, motion: _motion, hidden: _hidden, ...plain } = el;
  const uncropped: MediaElement = { ...plain, frame: { x: 0, y: 0, ...whole } };
  const keep = (next: Rect | undefined) => {
    const s = useEditor.getState();
    if (!s.doc) return;
    commit(
      mapElements(s.doc, slideId, [el.id], (value) =>
        value.kind === 'image' ? croppedElement(value, next) : value,
      ),
    );
    onClose();
  };
  return (
    <Dialog
      title="Crop this picture"
      size="md"
      testId="crop-slide-picture"
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => keep(undefined)}>Whole picture</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => keep(keptCrop(crop, el.flipX, el.flipY))}>
            Keep crop
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        Drag the frame, or its sides and corners, over the part to keep. Other slides keep their picture.
      </p>
      <div
        data-testid="slide-crop-frame"
        data-a11y-picture
        className="relative mx-auto touch-none rounded-md border border-line bg-black"
        style={{
          aspectRatio: `${String(whole.width)} / ${String(whole.height)}`,
          width: `min(100%, ${String(Math.round((CROP_AREA_HEIGHT * whole.width) / whole.height))}px)`,
        }}
      >
        <PlacedInParent
          fractional
          content={whole}
          mode="fit"
          className="pointer-events-none absolute inset-0"
        >
          <ElementView el={uncropped} media="still" />
        </PlacedInParent>
        <div ref={area} className="absolute inset-0">
          <CropBox
            frame={area}
            picture={{ left: 0, top: 0, width: 100, height: 100 }}
            crop={crop}
            change={setCrop}
            shape={shape}
            turned={whole}
            testId="slide-crop-box"
            describedBy={CROP_READOUT_ID}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <CropShapes
          shape={shape}
          choose={(next) => {
            setShape(next);
            setCrop((was) => cropForShape(next, whole, was));
          }}
          testId="slide-crop-shapes"
          idPrefix="slide-crop"
        />
        <p id={CROP_READOUT_ID} className="text-xs text-muted tabular-nums" data-testid="crop-readout">
          {cropReadout(crop)}
        </p>
      </div>
    </Dialog>
  );
}

/** The tallest the dialog's picture is drawn (CSS pixels): room for its buttons in a 645-pixel-high window. */
const CROP_AREA_HEIGHT = 300;
