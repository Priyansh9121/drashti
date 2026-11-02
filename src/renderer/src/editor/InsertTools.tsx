import { useState } from 'react';
import type { MediaElement, Rect } from '../../../shared/model';
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
    const cells = tableElements(rows, columns, look, s.doc);
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

function CropDialog({ el, slideId, onClose }: { el: MediaElement; slideId: string; onClose: () => void }) {
  const old = el.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const [edges, setEdges] = useState({
    left: old.x * 100,
    top: old.y * 100,
    right: (1 - old.x - old.width) * 100,
    bottom: (1 - old.y - old.height) * 100,
  });
  const valid =
    edges.left + edges.right <= 99 &&
    edges.top + edges.bottom <= 99 &&
    Object.values(edges).every((n) => Number.isFinite(n) && n >= 0 && n <= 99);
  const keep = (crop: Rect | undefined) => {
    const s = useEditor.getState();
    if (!s.doc) return;
    commit(
      mapElements(s.doc, slideId, [el.id], (value) =>
        value.kind === 'image' ? croppedElement(value, crop) : value,
      ),
    );
    onClose();
  };
  return (
    <Dialog
      title="Crop this picture"
      size="sm"
      testId="crop-slide-picture"
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => keep(undefined)}>Whole picture</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() =>
              keep({
                x: edges.left / 100,
                y: edges.top / 100,
                width: (100 - edges.left - edges.right) / 100,
                height: (100 - edges.top - edges.bottom) / 100,
              })
            }
          >
            Keep crop
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        How much to take off each edge, in percent. Other slides keep their picture.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {(['left', 'top', 'right', 'bottom'] as const).map((edge) => (
          <Field key={edge} label={edge.charAt(0).toUpperCase() + edge.slice(1)}>
            <NumberInput
              aria-label={`Take off the ${edge} (%)`}
              data-testid={`crop-${edge}`}
              min={0}
              max={99}
              step={1}
              value={Math.round(edges[edge] * 100) / 100}
              onChange={(e) => setEdges({ ...edges, [edge]: Number(e.target.value) })}
            />
          </Field>
        ))}
      </div>
      {!valid && (
        <p role="alert" className="mt-2 text-sm text-warning-fg">
          Keep at least 1% of the picture each way.
        </p>
      )}
    </Dialog>
  );
}
