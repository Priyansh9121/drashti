import { useMemo, useState } from 'react';
import type { MaskShape, MaskShapeKind } from '../../../shared/masks';
import { MASK_SHAPE_KINDS, MASK_SHAPE_NAMES, maskImageUrl, newMaskShape } from '../../../shared/masks';
import { CANVAS_PRESETS } from '../../../shared/screens';
import { BoxCanvas } from '../boxes/BoxCanvas';
import { useScreens } from '../screens/screens-store';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { Field, NumberInput, Select, TextInput } from '../ui/Field';
import { CopyPlus, Plus, Trash2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import {
  change,
  chooseShape,
  closeMasks,
  duplicate,
  isDirty,
  remove,
  save,
  show,
  startNew,
  useMasks,
} from './masks-store';

/*
 * The mask editor (the Masks panel, or a group's settings in Screens): the
 * masks on the left, the mask drawn over its canvas in the middle (a test
 * pattern shows what it lets through; black is what it hides), and the
 * chosen shape's settings on the right. Changes are kept until Save.
 */

/** A pattern that shows what a mask lets through: a grid on a soft gradient. */
const PATTERN: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  backgroundColor: '#3e63dd',
  backgroundImage:
    'linear-gradient(135deg, rgb(255 255 255 / 0.18), rgb(0 0 0 / 0.18)), linear-gradient(rgb(255 255 255 / 0.35) 2px, transparent 2px), linear-gradient(90deg, rgb(255 255 255 / 0.35) 2px, transparent 2px)',
  backgroundSize: '100% 100%, 120px 120px, 120px 120px',
};

function ShapeSettings({ shape }: { shape: MaskShape }) {
  const set = (patch: Partial<MaskShape>) => {
    change((e) => ({ ...e, shapes: e.shapes.map((s) => (s.id === shape.id ? { ...s, ...patch } : s)) }));
  };
  const frame = (key: 'x' | 'y' | 'width' | 'height', value: number) => {
    if (!Number.isFinite(value)) return;
    const min = key === 'width' || key === 'height' ? 1 : -16384;
    set({ frame: { ...shape.frame, [key]: Math.max(min, Math.round(value)) } });
  };
  return (
    <div className="space-y-3" data-testid="mask-shape-settings">
      <Field label="Shape">
        <Select
          value={shape.kind}
          data-testid="mask-shape-kind"
          onChange={(e) => {
            const kind = e.target.value as MaskShapeKind;
            set({
              kind,
              ...(kind === 'rounded' && shape.radius === undefined
                ? { radius: Math.round(Math.min(shape.frame.width, shape.frame.height) / 8) }
                : {}),
            });
          }}
        >
          {MASK_SHAPE_KINDS.map((k) => (
            <option key={k} value={k}>
              {MASK_SHAPE_NAMES[k]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        {(['x', 'y', 'width', 'height'] as const).map((key) => (
          <Field
            key={key}
            label={key === 'x' ? 'Across' : key === 'y' ? 'Down' : key === 'width' ? 'Width' : 'Height'}
          >
            <NumberInput
              value={shape.frame[key]}
              unit="px"
              onChange={(e) => {
                frame(key, e.target.valueAsNumber);
              }}
            />
          </Field>
        ))}
      </div>
      {shape.kind === 'rounded' && (
        <Field label="Corners">
          <NumberInput
            value={shape.radius ?? 0}
            min={0}
            unit="px"
            onChange={(e) => {
              const v = e.target.valueAsNumber;
              if (Number.isFinite(v)) set({ radius: Math.max(0, Math.round(v)) });
            }}
          />
        </Field>
      )}
      <Button
        variant="danger"
        size="sm"
        icon={Trash2}
        onClick={() => {
          change((e) => ({ ...e, shapes: e.shapes.filter((s) => s.id !== shape.id) }));
          chooseShape(null);
        }}
      >
        Remove this shape
      </Button>
    </div>
  );
}

export function MaskEditor() {
  const s = useMasks();
  const screens = useScreens((x) => x.snapshot);
  const [kind, setKind] = useState<MaskShapeKind>('rectangle');
  const [ask, setAsk] = useState<null | { why: 'switch'; to: string } | { why: 'close' } | { why: 'remove' }>(
    null,
  );
  const e = s.editing;
  const image = useMemo(() => (e ? maskImageUrl(e) : ''), [e]);
  if (!s.open || !e) return null;
  const dirty = isDirty(s);
  const shape = e.shapes.find((x) => x.id === s.shapeId) ?? null;
  // Canvas sizes to start from: the presets, and each screen's own.
  const sizes = [
    ...CANVAS_PRESETS.map((p) => ({ label: p.label, width: p.width, height: p.height })),
    ...(screens?.groups ?? []).flatMap((g) =>
      g.screens.map((sc) => ({
        label: `${sc.name}: ${sc.canvasWidth} × ${sc.canvasHeight}`,
        width: sc.canvasWidth,
        height: sc.canvasHeight,
      })),
    ),
  ];
  const go = (to: string) => {
    if (dirty) setAsk({ why: 'switch', to });
    else show(to);
  };
  return (
    <Dialog
      title="Masks"
      subtitle="Shapes that hide part of a screen, or show only what is inside them."
      size="full"
      onClose={() => {
        if (dirty) setAsk({ why: 'close' });
        else closeMasks();
      }}
      closeLabel="Close masks"
      testId="mask-editor"
      bodyClassName="flex gap-4 overflow-hidden"
      footer={
        <>
          {e.id && (
            <Button
              variant="danger"
              icon={Trash2}
              className="mr-auto"
              onClick={() => {
                setAsk({ why: 'remove' });
              }}
            >
              Remove mask
            </Button>
          )}
          <Button
            disabled={!dirty || e.id === null}
            onClick={() => {
              if (e.id) show(e.id);
            }}
          >
            Undo changes
          </Button>
          <Button variant="primary" disabled={!dirty} onClick={() => void save()} data-testid="mask-save">
            Save
          </Button>
        </>
      }
    >
      <nav aria-label="Masks" className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto">
        <ul className="space-y-1" data-testid="mask-list">
          {(s.masks ?? []).map((m) => {
            const on = m.id === e.id;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  aria-current={on ? 'true' : undefined}
                  onClick={() => {
                    go(m.id);
                  }}
                  className={cx(
                    'w-full truncate rounded-md px-2 py-1.5 text-left text-sm',
                    on ? 'bg-panel-3 font-medium text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg',
                  )}
                >
                  {m.name}
                </button>
              </li>
            );
          })}
          {e.id === null && (
            <li>
              <span className="block w-full truncate rounded-md bg-panel-3 px-2 py-1.5 text-sm font-medium">
                {e.name} (not saved)
              </span>
            </li>
          )}
        </ul>
        <Button
          icon={Plus}
          data-testid="mask-new"
          onClick={() => {
            if (dirty) setAsk({ why: 'switch', to: '' });
            else startNew({ width: e.width, height: e.height });
          }}
        >
          New mask
        </Button>
        <Button icon={CopyPlus} onClick={duplicate} disabled={e.id === null}>
          Duplicate
        </Button>
      </nav>

      <BoxCanvas
        size={{ width: e.width, height: e.height }}
        boxes={e.shapes.map((x) => ({ id: x.id, frame: x.frame, name: MASK_SHAPE_NAMES[x.kind] }))}
        selected={s.shapeId}
        onSelect={chooseShape}
        onChange={(id, frame) => {
          change((x) => ({ ...x, shapes: x.shapes.map((sh) => (sh.id === id ? { ...sh, frame } : sh)) }));
        }}
        minSize={1}
        picture={
          <div style={{ position: 'absolute', inset: 0, background: '#000000' }}>
            <div
              data-testid="mask-preview"
              style={{ ...PATTERN, maskImage: image, maskSize: '100% 100%', maskRepeat: 'no-repeat' }}
            />
          </div>
        }
        label="The mask. Tab chooses the next shape, the arrow keys move it (Shift for ten pixels)."
        testId="mask-canvas"
      />

      <aside aria-label="Mask and shape settings" className="w-72 shrink-0 space-y-4 overflow-y-auto pr-1">
        {s.problem && <Notice tone="danger">{s.problem}</Notice>}
        <Field label="Mask name">
          <TextInput
            value={e.name}
            maxLength={60}
            data-testid="mask-name"
            onChange={(ev) => {
              const name = ev.target.value;
              change((x) => ({ ...x, name }));
            }}
          />
        </Field>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs font-medium text-muted">The shapes</legend>
          {(['hide', 'show'] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mask-mode"
                className="h-4 w-4 accent-accent-strong"
                checked={e.mode === mode}
                data-testid={`mask-mode-${mode}`}
                onChange={() => {
                  change((x) => ({ ...x, mode }));
                }}
              />
              {mode === 'hide' ? 'Hide what is inside them' : 'Show only what is inside them'}
            </label>
          ))}
        </fieldset>
        <Field label="Canvas" hint="The mask is stretched over each screen it goes on.">
          <Select
            value={`${e.width}x${e.height}`}
            onChange={(ev) => {
              const [w, h] = ev.target.value.split('x').map(Number);
              if (w && h) change((x) => ({ ...x, width: w, height: h }));
            }}
          >
            {!sizes.some((z) => z.width === e.width && z.height === e.height) && (
              <option value={`${e.width}x${e.height}`}>
                {e.width} × {e.height}
              </option>
            )}
            {sizes
              .filter((z, i) => sizes.findIndex((y) => y.width === z.width && y.height === z.height) === i)
              .map((z) => (
                <option key={z.label} value={`${z.width}x${z.height}`}>
                  {z.label}
                </option>
              ))}
          </Select>
        </Field>
        <section className="space-y-2">
          <SectionTitle>Shapes</SectionTitle>
          <ul className="space-y-1" data-testid="mask-shape-list">
            {e.shapes.map((x, i) => (
              <li key={x.id}>
                <button
                  type="button"
                  aria-pressed={x.id === s.shapeId}
                  onClick={() => {
                    chooseShape(x.id);
                  }}
                  className={cx(
                    'w-full truncate rounded-md border px-2 py-1 text-left text-sm',
                    x.id === s.shapeId ? 'border-accent bg-panel-3' : 'border-line hover:bg-panel-2',
                  )}
                >
                  {MASK_SHAPE_NAMES[x.kind]} {i + 1}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Select
              aria-label="Kind of shape to add"
              className="min-w-0 flex-1"
              value={kind}
              data-testid="mask-add-kind"
              onChange={(ev) => {
                setKind(ev.target.value as MaskShapeKind);
              }}
            >
              {MASK_SHAPE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {MASK_SHAPE_NAMES[k]}
                </option>
              ))}
            </Select>
            <Button
              icon={Plus}
              disabled={e.shapes.length >= 40}
              data-testid="mask-add-shape"
              onClick={() => {
                const made = newMaskShape(kind, crypto.randomUUID(), e);
                change((x) => ({ ...x, shapes: [...x.shapes, made] }));
                chooseShape(made.id);
              }}
            >
              Add
            </Button>
          </div>
        </section>
        {shape ? (
          <ShapeSettings shape={shape} />
        ) : (
          <p className="text-xs text-muted">Choose a shape to change it.</p>
        )}
      </aside>

      {ask && (
        <ConfirmDialog
          title={ask.why === 'remove' ? `Remove “${e.name}”?` : 'Throw away the changes?'}
          confirmLabel={ask.why === 'remove' ? 'Remove' : 'Throw away'}
          onCancel={() => {
            setAsk(null);
          }}
          onConfirm={() => {
            const was = ask;
            setAsk(null);
            if (was.why === 'remove') void remove();
            else if (was.why === 'close') closeMasks();
            else if (was.to === '') startNew({ width: e.width, height: e.height });
            else show(was.to);
          }}
          testId="mask-confirm"
        >
          <p>
            {ask.why === 'remove'
              ? 'It comes off the screens if it is up, and every Look that gave it to a group shows that group’s whole picture.'
              : 'The changes to this mask have not been saved.'}
          </p>
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
