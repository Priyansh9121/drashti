import { useState } from 'react';
import type { ReactNode } from 'react';
import type {
  Lang,
  MediaElement,
  Outline,
  Shadow,
  ShapeElement,
  ShapeKind,
  SlideElement,
  TextElement,
} from '../../../shared/model';
import { legacyFontOf } from '../../../shared/slide-edit';
import { LANG_NAMES } from '../../../shared/themes';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { ColorInput, Field, NumberInput, Select, Slider, TextInput } from '../ui/Field';
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  BringToFront,
  CopyPlus,
  Italic,
  SendToBack,
  Trash2,
} from '../ui/icons';
import type { Icon } from '../ui/icons';
import { Toggle } from '../ui/Toggle';
import { BUNDLED_FAMILIES } from '../render/fonts';
import { commit, useEditor } from './editor-store';
import type { Alignment } from './geometry';
import { alignMoves, boundsOf, distributeMoves } from './geometry';
import type { Arrange, BoxPatch, TextPatch } from './ops';
import {
  arrange,
  deleteElements,
  duplicateElements,
  findSlide,
  mapElements,
  moveEach,
  styleBox,
} from './ops';
import { restyle, restyleAll, selectedLook } from './runs-doc';
import { SlidePanel } from './SlidePanel';
import { activeText } from './TextBoxEditor';

/*
 * The inspector: what is selected, as numbers and choices. Text styles go
 * to the whole box, or to the selected words while typing in it.
 */

const round = (n: number) => Math.round(n * 100) / 100;

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="space-y-2 border-b border-line px-3 py-3" aria-label={title} data-testid={testId}>
      <h3 className="text-2xs font-bold tracking-wider text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** A number that changes as it is typed or stepped; each change joins one step for Undo. */
function NumberField({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  step = 1,
  testId,
  stack = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  testId?: string;
  /** The label above the field (a grid of them), not beside it. */
  stack?: boolean;
}) {
  // What is typed while the field has the keyboard; otherwise the value itself.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Field label={stack && unit ? `${label} (${unit})` : label} layout={stack ? 'stack' : 'inline'}>
      <NumberInput
        value={draft ?? String(value)}
        unit={stack ? undefined : unit}
        min={min}
        max={max}
        step={step}
        data-testid={testId}
        className={stack ? 'w-full min-w-0' : 'w-20'}
        onFocus={() => {
          setDraft(String(value));
        }}
        onBlur={() => {
          setDraft(null);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() === '' || !Number.isFinite(n)) return;
          onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
        }}
      />
    </Field>
  );
}

/** A row of buttons of which one is on (alignment, and the like). */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: readonly { value: T; label: string; icon: Icon }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      <span className="mr-1 text-xs font-medium text-muted">{label}</span>
      {options.map((o) => (
        <IconButton
          key={o.value}
          icon={o.icon}
          label={o.label}
          size="sm"
          variant={value === o.value ? 'secondary' : 'ghost'}
          aria-pressed={value === o.value}
          onClick={() => {
            onChange(o.value);
          }}
        />
      ))}
    </div>
  );
}

/** A colour that may see through (#rrggbbaa): the picker changes the colour, and keeps how much it sees through. */
function withSameAlpha(next: string, was: string | null | undefined): string {
  const alpha = was?.length === 9 ? was.slice(7) : '';
  return `${next}${alpha}`;
}

export function Inspector() {
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.slideId);
  const selection = useEditor((s) => s.selection);
  const editing = useEditor((s) => s.editing);
  // The look at the caret changes as words are typed and selected.
  useEditor((s) => s.textTick);
  const slide = doc ? findSlide(doc, slideId) : undefined;
  if (!doc || !slide)
    return <aside className="w-72 shrink-0 border-l border-line bg-panel" aria-label="Inspector" />;
  const selected = slide.elements.filter((e) => selection.includes(e.id));
  const single = selected.length === 1 ? selected[0] : undefined;

  const change = (ids: readonly string[], fn: (el: SlideElement) => SlideElement, coalesce?: string) => {
    const now = useEditor.getState().doc;
    if (now) commit(mapElements(now, slide.id, ids, fn), coalesce ? { coalesce } : {});
  };
  const doArrange = (how: Arrange) => {
    const now = useEditor.getState().doc;
    if (now) commit(arrange(now, slide.id, selection, how));
  };
  const align = (how: Alignment) => {
    const now = useEditor.getState().doc;
    if (!now) return;
    const moves = alignMoves(
      selected.map((el) => boundsOf(el)),
      how,
      doc,
    );
    commit(moveEach(now, slide.id, new Map(selected.map((el, i) => [el.id, moves[i] ?? { x: 0, y: 0 }]))));
  };
  const distribute = (axis: 'x' | 'y') => {
    const now = useEditor.getState().doc;
    if (!now) return;
    const moves = distributeMoves(
      selected.map((el) => boundsOf(el)),
      axis,
    );
    commit(moveEach(now, slide.id, new Map(selected.map((el, i) => [el.id, moves[i] ?? { x: 0, y: 0 }]))));
  };

  return (
    <aside
      className="w-72 shrink-0 overflow-y-auto border-l border-line bg-panel"
      aria-label="Inspector"
      data-testid="inspector"
    >
      {selected.length === 0 ? (
        <>
          <p className="px-3 pt-3 text-xs text-faint">
            Choose something on the slide to change it, or add words, a shape, a picture or a video above.
          </p>
          <SlidePanel doc={doc} slide={slide} />
        </>
      ) : (
        <>
          <Section title={single ? 'Selected' : `${selected.length} selected`} testId="inspector-arrange">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ['left', 'Line up the left edges', AlignStartVertical],
                  ['center', 'Line up the middles across', AlignCenterVertical],
                  ['right', 'Line up the right edges', AlignEndVertical],
                  ['top', 'Line up the tops', AlignStartHorizontal],
                  ['middle', 'Line up the middles down', AlignCenterHorizontal],
                  ['bottom', 'Line up the bottoms', AlignEndHorizontal],
                ] as const
              ).map(([how, label, icon]) => (
                <IconButton
                  key={how}
                  icon={icon}
                  size="sm"
                  label={single ? `${label} (with the slide)` : label}
                  onClick={() => {
                    align(how);
                  }}
                />
              ))}
              <IconButton
                icon={AlignHorizontalDistributeCenter}
                size="sm"
                label="Space out evenly across"
                disabled={selected.length < 3}
                onClick={() => {
                  distribute('x');
                }}
              />
              <IconButton
                icon={AlignVerticalDistributeCenter}
                size="sm"
                label="Space out evenly down"
                disabled={selected.length < 3}
                onClick={() => {
                  distribute('y');
                }}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <IconButton
                icon={BringToFront}
                size="sm"
                label="Bring to the front"
                onClick={() => doArrange('front')}
              />
              <IconButton
                icon={ArrowUp}
                size="sm"
                label="Bring forward"
                onClick={() => doArrange('forward')}
              />
              <IconButton
                icon={ArrowDown}
                size="sm"
                label="Send backward"
                onClick={() => doArrange('backward')}
              />
              <IconButton
                icon={SendToBack}
                size="sm"
                label="Send to the back"
                onClick={() => doArrange('back')}
              />
              <IconButton
                icon={CopyPlus}
                size="sm"
                label="Duplicate"
                onClick={() => {
                  const now = useEditor.getState().doc;
                  if (!now) return;
                  const copied = duplicateElements(now, slide.id, selection);
                  commit(copied.doc, { select: copied.ids });
                }}
              />
              <IconButton
                icon={Trash2}
                size="sm"
                variant="danger"
                label="Delete"
                onClick={() => {
                  const now = useEditor.getState().doc;
                  if (now) commit(deleteElements(now, slide.id, selection), { select: [] });
                }}
              />
            </div>
          </Section>
          {single && <PlaceSection el={single} change={change} />}
          {single?.kind === 'text' && (
            <TextSection el={single} slideId={slide.id} editing={editing === single.id} />
          )}
          {single?.kind === 'shape' && <ShapeSection el={single} change={change} />}
          {(single?.kind === 'image' || single?.kind === 'video') && (
            <MediaSection el={single} change={change} />
          )}
        </>
      )}
    </aside>
  );
}

type Change = (ids: readonly string[], fn: (el: SlideElement) => SlideElement, coalesce?: string) => void;

function PlaceSection({ el, change }: { el: SlideElement; change: Change }) {
  const f = el.frame;
  const set = (key: 'x' | 'y' | 'width' | 'height', value: number) => {
    change([el.id], (e) => ({ ...e, frame: { ...e.frame, [key]: round(value) } }), `place:${el.id}:${key}`);
  };
  const opacity = el.kind === 'shape' ? el.opacity : (el.opacity ?? 1);
  return (
    <Section title="Place and size" testId="inspector-place">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <NumberField stack label="Across" value={round(f.x)} onChange={(v) => set('x', v)} testId="field-x" />
        <NumberField stack label="Down" value={round(f.y)} onChange={(v) => set('y', v)} testId="field-y" />
        <NumberField
          stack
          label="Width"
          value={round(f.width)}
          min={1}
          onChange={(v) => set('width', v)}
          testId="field-width"
        />
        <NumberField
          stack
          label="Height"
          value={round(f.height)}
          min={1}
          onChange={(v) => set('height', v)}
          testId="field-height"
        />
        <NumberField
          stack
          label="Turn"
          unit="°"
          value={round(el.rotation ?? 0)}
          min={-360}
          max={360}
          testId="field-rotation"
          onChange={(v) => {
            change(
              [el.id],
              (e) => {
                const { rotation: _r, ...rest } = e;
                return v % 360 === 0 ? rest : { ...rest, rotation: round(v) };
              },
              `place:${el.id}:rotation`,
            );
          }}
        />
        <NumberField
          stack
          label="Opacity"
          unit="%"
          value={Math.round(opacity * 100)}
          min={0}
          max={100}
          testId="field-opacity"
          onChange={(v) => {
            change(
              [el.id],
              (e) => {
                const value = round(v / 100);
                if (e.kind === 'shape') return { ...e, opacity: value };
                const { opacity: _o, ...rest } = e;
                return value >= 1 ? rest : { ...rest, opacity: value };
              },
              `place:${el.id}:opacity`,
            );
          }}
        />
      </div>
    </Section>
  );
}

const LANG_ORDER: Lang[] = ['gu', 'hi', 'en', 'translit'];

/** The shadow choice: none, Drashti's soft one, or one of its own. */
type ShadowChoice = 'none' | 'soft' | 'own';
const shadowChoice = (s: TextElement['style']['shadow'] | undefined): ShadowChoice =>
  s === false || s === undefined ? 'none' : s === true ? 'soft' : 'own';

function TextSection({ el, slideId, editing }: { el: TextElement; slideId: string; editing: boolean }) {
  const legacy = legacyFontOf(el);
  const active = editing ? activeText() : null;
  const words = active !== null && !active.view.state.selection.empty;
  // What the inspector shows: the selected words' look over the box's.
  const look = active ? selectedLook(active.view.state) : {};
  const s = el.style;
  const shown = {
    lang: look.lang !== undefined ? look.lang : el.lang,
    font: look.font !== undefined ? look.font : s.fontFamily,
    size: look.size ?? s.fontSize,
    weight: look.weight ?? s.fontWeight,
    italic: look.italic ?? false,
    color: look.color ?? s.color,
    shadow: look.shadow ?? s.shadow,
    outline: look.outline !== undefined ? look.outline : (s.outline ?? null),
  };

  /** A change to how the text looks: the selected words, or the whole box. */
  const apply = (patch: TextPatch, coalesce?: string) => {
    const now = useEditor.getState().doc;
    if (!now) return;
    if (active && words) {
      active.view.dispatch(restyle(active.view.state, patch));
      return;
    }
    commit(
      mapElements(now, slideId, [el.id], (e) => (e.kind === 'text' ? styleBox(e, patch) : e)),
      coalesce ? { coalesce } : {},
    );
    // The words being typed follow the box too.
    if (active) {
      const clear: TextPatch = {};
      for (const k of Object.keys(patch) as (keyof TextPatch)[]) clear[k] = undefined;
      if ('italic' in patch) clear.italic = patch.italic ? true : undefined;
      active.view.dispatch(restyleAll(active.view.state, clear));
    }
  };
  const applyBox = (box: BoxPatch, coalesce?: string) => {
    const now = useEditor.getState().doc;
    if (now)
      commit(
        mapElements(now, slideId, [el.id], (e) =>
          e.kind === 'text' ? { ...e, style: { ...e.style, ...box } } : e,
        ),
        coalesce ? { coalesce } : {},
      );
  };

  if (legacy)
    return (
      <Section title="Words" testId="inspector-text">
        <p className="text-sm text-warning-fg" data-testid="legacy-note">
          These words are typed in a legacy font ({legacy}). The box can be moved, resized and turned, but its
          words and their look cannot be edited until the font can be converted.
        </p>
      </Section>
    );

  const shadow = shown.shadow;
  const own: Shadow | null = typeof shadow === 'object' ? shadow : null;
  const outline: Outline | null = shown.outline;
  return (
    <Section title="Words" testId="inspector-text">
      <p className="text-xs text-faint" data-testid="text-target">
        {words
          ? 'Styling the selected words.'
          : 'Styling the whole box. Select words while typing to style just them.'}
      </p>
      <Field label="Language" layout="inline">
        <Select
          className="flex-1"
          data-testid="field-lang"
          value={shown.lang ?? ''}
          onChange={(e) => {
            apply({ lang: e.target.value === '' ? null : (e.target.value as Lang) });
          }}
        >
          <option value="">From the script</option>
          {LANG_ORDER.map((l) => (
            <option key={l} value={l}>
              {LANG_NAMES[l]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Font" layout="inline">
        <TextInput
          list="editor-fonts"
          className="flex-1"
          data-testid="field-font"
          placeholder="The language’s own"
          value={shown.font ?? ''}
          onChange={(e) => {
            apply({ font: e.target.value.trim() === '' ? null : e.target.value }, `font:${el.id}`);
          }}
        />
        <datalist id="editor-fonts">
          {BUNDLED_FAMILIES.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </Field>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <NumberField
          label="Size"
          value={round(shown.size)}
          min={4}
          max={2000}
          testId="field-size"
          onChange={(v) => {
            apply({ size: v }, `size:${el.id}`);
          }}
        />
        <Field label="Weight" layout="inline">
          <Select
            data-testid="field-weight"
            value={String(shown.weight >= 650 ? 700 : shown.weight >= 450 ? 500 : 400)}
            onChange={(e) => {
              apply({ weight: Number(e.target.value) });
            }}
          >
            <option value="400">Regular</option>
            <option value="500">Medium</option>
            <option value="700">Bold</option>
          </Select>
        </Field>
        <IconButton
          icon={Italic}
          size="sm"
          label="Italic"
          variant={shown.italic ? 'secondary' : 'ghost'}
          aria-pressed={shown.italic}
          onClick={() => {
            apply({ italic: !shown.italic });
          }}
        />
      </div>
      <Field label="Colour" layout="inline">
        <ColorInput
          data-testid="field-color"
          value={shown.color.slice(0, 7)}
          onChange={(e) => {
            apply({ color: withSameAlpha(e.target.value, shown.color) }, `color:${el.id}`);
          }}
        />
      </Field>
      <Field label="Shadow" layout="inline">
        <Select
          className="flex-1"
          data-testid="field-shadow"
          value={shadowChoice(shadow)}
          onChange={(e) => {
            const v = e.target.value as ShadowChoice;
            apply({
              shadow:
                v === 'none'
                  ? false
                  : v === 'soft'
                    ? true
                    : {
                        color: '#000000d9',
                        blur: Math.round(shown.size * 0.18),
                        x: 0,
                        y: Math.round(shown.size * 0.06),
                      },
            });
          }}
        >
          <option value="none">None</option>
          <option value="soft">Soft (Drashti’s)</option>
          <option value="own">Its own</option>
        </Select>
      </Field>
      {own && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 pl-2" data-testid="shadow-own">
          <Field label="Colour" layout="inline" className="col-span-2">
            <ColorInput
              value={own.color.slice(0, 7)}
              onChange={(e) => {
                apply(
                  { shadow: { ...own, color: withSameAlpha(e.target.value, own.color) } },
                  `shadow:${el.id}`,
                );
              }}
            />
          </Field>
          <NumberField
            label="Blur"
            value={own.blur}
            min={0}
            max={200}
            testId="field-shadow-blur"
            onChange={(v) => {
              apply({ shadow: { ...own, blur: v } }, `shadow:${el.id}`);
            }}
          />
          <NumberField
            label="Across"
            value={own.x}
            min={-500}
            max={500}
            testId="field-shadow-x"
            onChange={(v) => {
              apply({ shadow: { ...own, x: v } }, `shadow:${el.id}`);
            }}
          />
          <NumberField
            label="Down"
            value={own.y}
            min={-500}
            max={500}
            testId="field-shadow-y"
            onChange={(v) => {
              apply({ shadow: { ...own, y: v } }, `shadow:${el.id}`);
            }}
          />
        </div>
      )}
      <Toggle
        label="Outline round the letters"
        checked={outline !== null}
        data-testid="field-outline"
        onChange={(on) => {
          apply({
            outline: on ? { color: '#000000', width: Math.max(1, Math.round(shown.size / 30)) } : null,
          });
        }}
      />
      {outline && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 pl-2">
          <Field label="Colour" layout="inline" className="col-span-2">
            <ColorInput
              value={outline.color.slice(0, 7)}
              onChange={(e) => {
                apply(
                  { outline: { ...outline, color: withSameAlpha(e.target.value, outline.color) } },
                  `outline:${el.id}`,
                );
              }}
            />
          </Field>
          <NumberField
            label="Width"
            value={outline.width}
            min={0.5}
            max={100}
            step={0.5}
            testId="field-outline-width"
            onChange={(v) => {
              apply({ outline: { ...outline, width: v } }, `outline:${el.id}`);
            }}
          />
        </div>
      )}
      <div className="space-y-2 border-t border-line pt-2">
        <p className="text-xs text-faint">For the whole box:</p>
        <Choice
          label="Align"
          value={s.align}
          options={[
            { value: 'left', label: 'Left', icon: AlignLeft },
            { value: 'center', label: 'Centre', icon: AlignCenter },
            { value: 'right', label: 'Right', icon: AlignRight },
          ]}
          onChange={(align) => {
            applyBox({ align });
          }}
        />
        <Choice
          label="Place"
          value={s.verticalAlign}
          options={[
            { value: 'top', label: 'At the top', icon: ArrowUpToLine },
            { value: 'middle', label: 'In the middle', icon: AlignCenterHorizontal },
            { value: 'bottom', label: 'At the bottom', icon: ArrowDownToLine },
          ]}
          onChange={(verticalAlign) => {
            applyBox({ verticalAlign });
          }}
        />
        <NumberField
          label="Line spacing"
          value={s.lineHeight}
          min={0.6}
          max={3}
          step={0.05}
          testId="field-line-height"
          onChange={(v) => {
            applyBox({ lineHeight: v }, `lineHeight:${el.id}`);
          }}
        />
        <Toggle
          label="Shrink the words to fit the box"
          checked={s.shrinkToFit === true}
          data-testid="field-shrink"
          onChange={(on) => {
            applyBox({ shrinkToFit: on });
          }}
        />
      </div>
    </Section>
  );
}

function ShapeSection({ el, change }: { el: ShapeElement; change: Change }) {
  const kind = el.shape ?? 'rectangle';
  const outline = el.outline ?? null;
  const set = (patch: Partial<ShapeElement>, coalesce?: string) => {
    change([el.id], (e) => (e.kind === 'shape' ? { ...e, ...patch } : e), coalesce);
  };
  return (
    <Section title="Shape" testId="inspector-shape">
      <Field label="Kind" layout="inline">
        <Select
          className="flex-1"
          data-testid="field-shape"
          value={kind}
          onChange={(e) => {
            const next = e.target.value as ShapeKind;
            if (next === 'line')
              set({
                shape: 'line',
                fill: null,
                outline: outline ?? { color: el.fill?.slice(0, 7) ?? '#ffffff', width: 6 },
                frame: { ...el.frame, y: el.frame.y + el.frame.height / 2 - 10, height: 20 },
              });
            else set({ shape: next, fill: el.fill ?? (kind === 'line' ? '#000000' : null) });
          }}
        >
          <option value="rectangle">Rectangle</option>
          <option value="ellipse">Ellipse</option>
          <option value="line">Line</option>
        </Select>
      </Field>
      {kind !== 'line' && (
        <>
          <Toggle
            label="Filled"
            checked={el.fill !== null}
            data-testid="field-filled"
            onChange={(on) => {
              set({ fill: on ? '#000000' : null });
            }}
          />
          {el.fill !== null && (
            <Field label="Fill" layout="inline" className="pl-2">
              <ColorInput
                data-testid="field-fill"
                value={el.fill.slice(0, 7)}
                onChange={(e) => {
                  set({ fill: withSameAlpha(e.target.value, el.fill) }, `fill:${el.id}`);
                }}
              />
            </Field>
          )}
          <Toggle
            label="Outline"
            checked={outline !== null}
            data-testid="field-shape-outline"
            onChange={(on) => {
              set({ outline: on ? { color: '#ffffff', width: 4 } : null });
            }}
          />
        </>
      )}
      {outline && (
        <div className={cx('grid grid-cols-2 gap-x-3 gap-y-2', kind !== 'line' && 'pl-2')}>
          <Field label={kind === 'line' ? 'Colour' : 'Outline colour'} layout="inline" className="col-span-2">
            <ColorInput
              value={outline.color.slice(0, 7)}
              onChange={(e) => {
                set(
                  { outline: { ...outline, color: withSameAlpha(e.target.value, outline.color) } },
                  `stroke:${el.id}`,
                );
              }}
            />
          </Field>
          <NumberField
            label={kind === 'line' ? 'Thickness' : 'Width'}
            value={outline.width}
            min={0.5}
            max={200}
            step={0.5}
            testId="field-stroke-width"
            onChange={(v) => {
              set({ outline: { ...outline, width: v } }, `stroke:${el.id}`);
            }}
          />
        </div>
      )}
      {kind === 'rectangle' && (
        <NumberField
          label="Corners"
          value={el.cornerRadius}
          min={0}
          max={2000}
          testId="field-corners"
          onChange={(v) => {
            set({ cornerRadius: v }, `corners:${el.id}`);
          }}
        />
      )}
    </Section>
  );
}

function MediaSection({ el, change }: { el: MediaElement; change: Change }) {
  const set = (fn: (e: MediaElement) => MediaElement, coalesce?: string) => {
    change([el.id], (e) => (e.kind === 'image' || e.kind === 'video' ? fn(e) : e), coalesce);
  };
  const volume = el.volume ?? 1;
  return (
    <Section title={el.kind === 'video' ? 'Video' : 'Picture'} testId="inspector-media">
      <Field label="Fit" layout="inline">
        <Select
          className="flex-1"
          data-testid="field-fit"
          value={el.fit}
          onChange={(e) => {
            const fit = e.target.value as MediaElement['fit'];
            set((m) => ({ ...m, fit }));
          }}
        >
          <option value="fit">Fit inside, all of it seen</option>
          <option value="fill">Fill, cutting the edges</option>
          <option value="stretch">Stretch to the box</option>
        </Select>
      </Field>
      {el.kind === 'video' && (
        <>
          <Toggle
            label="Play again from the start at the end"
            checked={el.loop === true}
            data-testid="field-loop"
            onChange={(on) => {
              set((m) => {
                const { loop: _l, ...rest } = m;
                return on ? { ...rest, loop: true } : rest;
              });
            }}
          />
          <Toggle
            label="Its sound"
            checked={volume > 0}
            data-testid="field-sound"
            onChange={(on) => {
              set((m) => {
                const { volume: _v, ...rest } = m;
                return on ? rest : { ...rest, volume: 0 };
              });
            }}
          />
          {volume > 0 && (
            <Field label="Volume" layout="inline" className="pl-2">
              <Slider
                value={Math.round(volume * 100)}
                min={1}
                max={100}
                format={(v) => `${v}%`}
                data-testid="field-volume"
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  set((m) => {
                    const { volume: _v, ...rest } = m;
                    return v >= 1 ? rest : { ...rest, volume: v };
                  }, `volume:${el.id}`);
                }}
              />
            </Field>
          )}
        </>
      )}
    </Section>
  );
}

/** For the editor's toolbar: a button that adds something. */
export function AddButton({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <Button size="sm" icon={icon} onClick={onClick} data-testid={testId}>
      {label}
    </Button>
  );
}
