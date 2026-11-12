import { SHAPE_NAMES, type ShapeElement, type SlideElement, type TextElement } from '../../../shared/model';
import { cutText } from '../../../shared/text';
import { Button } from '../ui/Button';
import { Field, NumberInput, Select } from '../ui/Field';

export function TableEditor({
  cells,
  activeId,
  edit,
}: {
  cells: readonly TextElement[];
  activeId?: string;
  edit: (id: string) => void;
}) {
  const ordered = cells
    .flatMap((element) => (element.tableCell ? [{ ...element.tableCell, element }] : []))
    .sort((a, b) => a.row - b.row || a.column - b.column);
  if (!ordered.length) return null;
  return (
    <div role="group" aria-label="Table cells" className="flex max-h-40 flex-col gap-1 overflow-y-auto">
      {ordered.map(({ element, row, column }) => (
        <Button
          key={element.id}
          size="sm"
          aria-pressed={element.id === activeId}
          onClick={() => edit(element.id)}
        >
          {'Edit row ' + String(row + 1) + ', column ' + String(column + 1)}
        </Button>
      ))}
    </div>
  );
}

const DIRECTIONS = {
  horizontal: 'Horizontal',
  'vertical-rl': 'Vertical, right to left',
  'vertical-lr': 'Vertical, left to right',
  'sideways-lr': 'Sideways, left to right',
} as const;

function GradientFields({
  element,
  update,
}: {
  element: ShapeElement;
  update: (next: ShapeElement) => void;
}) {
  const gradient = element.gradient;
  if (!gradient) return null;
  return (
    <>
      {gradient.kind === 'linear' && (
        <Field label="Gradient angle">
          <NumberInput
            min={0}
            max={360}
            value={gradient.angle}
            onChange={(event) => {
              const angle = event.currentTarget.valueAsNumber;
              if (Number.isFinite(angle))
                update({ ...element, gradient: { ...gradient, angle: Math.min(360, Math.max(0, angle)) } });
            }}
          />
        </Field>
      )}
      {gradient.stops.map((stop, index) => (
        <label key={index} className="flex items-center gap-2 text-xs text-muted">
          {'Gradient colour ' + String(index + 1)}
          <input
            type="color"
            value={cutText(stop.color, 7)}
            onChange={(event) => {
              const color = event.currentTarget.value + stop.color.slice(7);
              const stops = gradient.stops.map((other, at) => (at === index ? { ...other, color } : other));
              update({ ...element, gradient: { ...gradient, stops } });
            }}
          />
        </label>
      ))}
    </>
  );
}

export function SourceObjectFormat({
  element,
  update,
}: {
  element: SlideElement;
  update: (next: SlideElement) => void;
}) {
  if (element.kind === 'text' && element.style.clipToBox)
    return (
      <Field label="Text direction">
        <Select
          value={element.style.writingMode ?? 'horizontal'}
          onChange={(event) => {
            const direction = event.currentTarget.value as keyof typeof DIRECTIONS;
            if (!Object.hasOwn(DIRECTIONS, direction)) return;
            const { writingMode: _mode, textOrientation: _orientation, ...style } = element.style;
            update({
              ...element,
              style: { ...style, ...(direction === 'horizontal' ? {} : { writingMode: direction }) },
            });
          }}
        >
          {Object.entries(DIRECTIONS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
    );
  if (element.kind === 'shape') return <GradientFields element={element} update={update} />;
  if (element.kind === 'image' && element.pictureClip) {
    const { pictureClip, ...rest } = element;
    return (
      <Field label="Picture fill">
        <Select
          value={pictureClip.shape}
          onChange={(event) => update(event.currentTarget.value === 'full' ? rest : element)}
        >
          <option value={pictureClip.shape}>{SHAPE_NAMES[pictureClip.shape]}</option>
          <option value="full">Show full picture</option>
        </Select>
      </Field>
    );
  }
  return null;
}
