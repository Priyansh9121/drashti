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
  TimerAtZero,
  TimerElement,
} from '../../../shared/model';
import { countsDown, TIMER_KIND_NAMES, type TimerState } from '../../../shared/timers';
import { useEngine } from '../engine/engine-store';
import { legacyFontOf, slidesOf } from '../../../shared/slide-edit';
import {
  drawnPx,
  FLOOR_NOTE_PX,
  FLOOR_WARN_PX,
  floorOf,
  INDIC_LINE_HEIGHT_MIN,
  REFERENCE_LINES,
} from '../../../shared/readable';
import { isIndic } from '../../../shared/model';
import { wordsContrast, WORDS_CONTRAST_AIM, WORDS_CONTRAST_MIN } from '../../../shared/contrast';
import { LANG_NAMES } from '../../../shared/themes';
import { boxLines } from '../../../shared/tracks';
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
import { useTickerOver } from './SafeAreas';
import { activeText } from './TextBoxEditor';

/*
 * The inspector: what is selected, as numbers and choices. Text styles go
 * to the whole box, or to the selected words while typing in it.
 */

const round = (n: number) => Math.round(n * 100) / 100;

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="space-y-2 border-b border-line px-3 py-3" aria-label={title} data-testid={testId}>
      <h3 className="text-2xs font-bold tracking-wider text-heading uppercase">{title}</h3>
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
          {single?.kind === 'timer' && <TimerSection el={single} change={change} />}
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
/** The language choice for a box whose lines are in several languages. */
const SEVERAL = 'several';

/** The shadow choice: none, Drashti's soft one, or one of its own. */
type ShadowChoice = 'none' | 'soft' | 'own';
const shadowChoice = (s: TextElement['style']['shadow'] | undefined): ShadowChoice =>
  s === false || s === undefined ? 'none' : s === true ? 'soft' : 'own';

/**
 * Whether the hall can read a box's words (Sessions 31–36, SLD-1), as measured on the slide: words past the
 * box, and the size its smallest words are drawn at, at 1080 lines (a warning below 36 px, a note below 48).
 */
function Readability({ el }: { el: TextElement }) {
  const measured = useEditor((s) => s.measured[el.id]);
  const height = useEditor((s) => s.doc?.height ?? REFERENCE_LINES);
  const width = useEditor((s) => s.doc?.width ?? (REFERENCE_LINES * 16) / 9);
  // Where the ticker runs on a group that shows it (SLD-2), on or off the safe areas.
  const ticker = useTickerOver(el.frame, { width, height });
  const px = measured ? Math.round(drawnPx(el, height, measured.fit)) : 0;
  const floor = measured ? floorOf(drawnPx(el, height, measured.fit)) : null;
  const shrinks = el.style.shrinkToFit === true;
  // Gujarati or Hindi lines closer than 1.3 (Sessions 31–36, I18N-2): their marks can touch.
  const indicCrowded =
    el.style.lineHeight < INDIC_LINE_HEIGHT_MIN - 0.0001 &&
    (isIndic(el.lang) || boxLines(el).some((l) => isIndic(l.lang ?? el.lang)));
  // The words' contrast against what is behind them, darkening included (Sessions 31–36, SLD-3).
  const slide = useEditor((s) =>
    s.doc && s.slideId ? slidesOf(s.doc).find((x) => x.id === s.slideId) : undefined,
  );
  const overPicture = slide?.cues.some((c) => c.kind === 'background' && c.mediaId !== null) ?? false;
  const colors = [
    el.style.color,
    ...(el.runs ?? []).flatMap((r) => (r.text.trim() !== '' && r.color ? [r.color] : [])),
  ]
    .map((c) => c.slice(0, 7))
    .filter((c) => /^#[0-9a-f]{6}$/iu.test(c));
  const behind = (slide?.background ?? '#000000').slice(0, 7);
  const ratio =
    colors.length > 0
      ? Math.min(...colors.map((c) => wordsContrast(c, behind, slide?.darken ?? null)))
      : null;
  const contrastLevel =
    ratio === null
      ? null
      : ratio < WORDS_CONTRAST_MIN
        ? 'warning'
        : ratio < WORDS_CONTRAST_AIM
          ? 'note'
          : 'fine';
  return (
    <>
      {el.text.trim() !== '' &&
        (overPicture ? (
          <p className="text-sm text-muted" data-testid="inspector-contrast" data-level="unknown">
            Over a picture or a video the words’ contrast cannot be measured: darkening behind the words (the
            slide’s own settings) keeps them readable.
          </p>
        ) : (
          ratio !== null &&
          contrastLevel && (
            <p
              className={cx('text-sm', contrastLevel === 'warning' ? 'text-warning-fg' : 'text-muted')}
              data-testid="inspector-contrast"
              data-level={contrastLevel}
            >
              {contrastLevel === 'warning'
                ? `The words are ${ratio.toFixed(1)}:1 against what is behind them: below ${String(WORDS_CONTRAST_MIN)}:1 they fade on a projector. Choose another colour, or darken behind the words (the slide’s own settings).`
                : contrastLevel === 'note'
                  ? `The words are ${ratio.toFixed(1)}:1 against what is behind them: ${String(WORDS_CONTRAST_AIM)}:1 reads best.`
                  : `The words are ${ratio.toFixed(1)}:1 against what is behind them.`}
            </p>
          )
        ))}
      {ticker.length > 0 && el.text.trim() !== '' && (
        <p className="text-sm text-warning-fg" data-testid="inspector-ticker">
          <b>Words sit where the ticker runs</b> on {ticker.map((n) => `“${n}”`).join(' and ')}: when
          announcements run along the bottom, they cover them. Move the box up (View, then Show Safe Areas,
          shows the band).
        </p>
      )}
      {indicCrowded && (
        <p className="text-sm text-warning-fg" data-testid="inspector-line-height" data-level="warning">
          The line spacing is {String(el.style.lineHeight)}: below {String(INDIC_LINE_HEIGHT_MIN)}, Gujarati
          and Hindi marks can touch the line above. Line spacing is under Words.
        </p>
      )}
      {measured?.over && (
        <p className="text-sm text-warning-fg" data-testid="inspector-overset" role="status">
          <b>Words run past the box</b>
          {shrinks
            ? ', even as small as shrinking goes: make the box bigger, or give it fewer words.'
            : ': make the box bigger or the words smaller, or turn on Shrink the words to fit the box.'}
        </p>
      )}
      {floor && (
        <p
          className={cx('text-sm', floor === 'warning' ? 'text-warning-fg' : 'text-muted')}
          data-testid="inspector-floor"
          data-level={floor}
        >
          {floor === 'warning'
            ? `The words are drawn at ${String(px)} px on a 1080-line screen: below ${String(FLOOR_WARN_PX)} px they are hard to read from the back of the hall.`
            : `The words are drawn at ${String(px)} px on a 1080-line screen: ${String(FLOOR_NOTE_PX)} px or more reads best from the back of the hall.`}
        </p>
      )}
    </>
  );
}

function TextSection({ el, slideId, editing }: { el: TextElement; slideId: string; editing: boolean }) {
  const legacy = legacyFontOf(el);
  const active = editing ? activeText() : null;
  const words = active !== null && !active.view.state.selection.empty;
  // What the inspector shows: the selected words' look over the box's.
  const look = active ? selectedLook(active.view.state) : {};
  const s = el.style;
  // The whole box with lines in more than one language (a kirtan's tracks) is in several, not one of them.
  const several = !words && new Set(boxLines(el).flatMap((l) => (l.lang ? [l.lang] : []))).size > 1;
  // Every line (or the selected words) in Gujarati, Hindi or Sanskrit: drawn upright, so no Italic to offer.
  const langsHere = words
    ? [look.lang !== undefined ? look.lang : el.lang]
    : boxLines(el).map((l) => l.lang ?? el.lang);
  const allIndic = langsHere.length > 0 && langsHere.every((l) => isIndic(l));
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
      <Readability el={el} />
      <p className="text-xs text-faint" data-testid="text-target">
        {words
          ? 'Styling the selected words.'
          : 'Styling the whole box. Select words while typing to style just them.'}
      </p>
      <Field label="Language" layout="inline">
        <Select
          className="flex-1"
          data-testid="field-lang"
          value={several ? SEVERAL : (shown.lang ?? '')}
          onChange={(e) => {
            if (e.target.value === SEVERAL) return;
            apply({ lang: e.target.value === '' ? null : (e.target.value as Lang) });
          }}
        >
          {several && (
            <option value={SEVERAL} disabled>
              Several
            </option>
          )}
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
        {/* Gujarati, Hindi and Sanskrit are always drawn upright (Sessions 31–36, I18N-2): no Italic for them. */}
        {!allIndic && (
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
        )}
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
        <Toggle
          label="On every screen, whatever its languages"
          checked={el.everyScreen === true}
          data-testid="field-every-screen"
          onChange={(on) => {
            const now = useEditor.getState().doc;
            if (!now) return;
            commit(
              mapElements(now, slideId, [el.id], (e) => {
                if (e.kind !== 'text') return e;
                const { everyScreen: _was, ...rest } = e;
                return on ? { ...rest, everyScreen: true } : rest;
              }),
            );
          }}
        />
        <p className="text-xs text-faint">
          For a title or a footer on a kirtan’s slide: screens set to show only some languages still show it.
        </p>
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

const NO_TIMERS: TimerState[] = [];

/** A countdown's last minute in another colour until the operator chooses theirs (Session 50). */
const LAST_MINUTE_COLOR = '#f5a524';

/**
 * A Timer's own settings (Session 50): which timer it shows; its look, as words have (font, size, weight,
 * colour, shadow, outline, alignment); a countdown's last minute in another colour (off until chosen); and what
 * a countdown does at zero (holds at 0:00, or the next slide comes on).
 */
function TimerSection({ el, change }: { el: TimerElement; change: Change }) {
  const timers = useEngine((e) => e.state?.timers) ?? NO_TIMERS;
  const timer = timers.find((t) => t.id === el.timerId);
  const s = el.style;
  const own: Shadow | null = typeof s.shadow === 'object' ? s.shadow : null;
  const outline: Outline | null = s.outline ?? null;
  const set = (fn: (e: TimerElement) => TimerElement, coalesce?: string) => {
    change([el.id], (e) => (e.kind === 'timer' ? fn(e) : e), coalesce);
  };
  const setStyle = (patch: Partial<TimerElement['style']>, coalesce?: string) => {
    set((e) => ({ ...e, style: { ...e.style, ...patch } }), coalesce);
  };
  return (
    <Section title="Timer" testId="inspector-timer">
      <Field label="Timer" layout="inline">
        <Select
          className="flex-1"
          data-testid="field-timer"
          value={el.timerId}
          onChange={(e) => {
            const timerId = e.target.value;
            set((t) => ({ ...t, timerId }));
          }}
        >
          {!timer && (
            <option value={el.timerId} disabled>
              No longer in Timers
            </option>
          )}
          {timers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({TIMER_KIND_NAMES[t.kind]})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Font" layout="inline">
        <TextInput
          list="timer-fonts"
          className="flex-1"
          data-testid="field-timer-font"
          placeholder="Drashti’s own"
          value={s.fontFamily ?? ''}
          onChange={(e) => {
            setStyle(
              { fontFamily: e.target.value.trim() === '' ? null : e.target.value },
              `timer-font:${el.id}`,
            );
          }}
        />
        <datalist id="timer-fonts">
          {BUNDLED_FAMILIES.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </Field>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <NumberField
          label="Size"
          value={round(s.fontSize)}
          min={4}
          max={2000}
          testId="field-timer-size"
          onChange={(v) => {
            setStyle({ fontSize: v }, `timer-size:${el.id}`);
          }}
        />
        <Field label="Weight" layout="inline">
          <Select
            data-testid="field-timer-weight"
            value={String(s.fontWeight >= 650 ? 700 : s.fontWeight >= 450 ? 500 : 400)}
            onChange={(e) => {
              setStyle({ fontWeight: Number(e.target.value) });
            }}
          >
            <option value="400">Regular</option>
            <option value="500">Medium</option>
            <option value="700">Bold</option>
          </Select>
        </Field>
      </div>
      <Field label="Colour" layout="inline">
        <ColorInput
          data-testid="field-timer-color"
          value={s.color.slice(0, 7)}
          onChange={(e) => {
            setStyle({ color: withSameAlpha(e.target.value, s.color) }, `timer-color:${el.id}`);
          }}
        />
      </Field>
      <Field label="Shadow" layout="inline">
        <Select
          className="flex-1"
          data-testid="field-timer-shadow"
          value={shadowChoice(s.shadow)}
          onChange={(e) => {
            const v = e.target.value as ShadowChoice;
            setStyle({
              shadow:
                v === 'none'
                  ? false
                  : v === 'soft'
                    ? true
                    : {
                        color: '#000000d9',
                        blur: Math.round(s.fontSize * 0.18),
                        x: 0,
                        y: Math.round(s.fontSize * 0.06),
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
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 pl-2">
          <Field label="Colour" layout="inline" className="col-span-2">
            <ColorInput
              value={own.color.slice(0, 7)}
              onChange={(e) => {
                setStyle(
                  { shadow: { ...own, color: withSameAlpha(e.target.value, own.color) } },
                  `timer-shadow:${el.id}`,
                );
              }}
            />
          </Field>
          <NumberField
            label="Blur"
            value={own.blur}
            min={0}
            max={200}
            onChange={(v) => {
              setStyle({ shadow: { ...own, blur: v } }, `timer-shadow:${el.id}`);
            }}
          />
          <NumberField
            label="Down"
            value={own.y}
            min={-500}
            max={500}
            onChange={(v) => {
              setStyle({ shadow: { ...own, y: v } }, `timer-shadow:${el.id}`);
            }}
          />
        </div>
      )}
      <Toggle
        label="Outline round the digits"
        checked={outline !== null}
        data-testid="field-timer-outline"
        onChange={(on) => {
          set((e) => {
            const { outline: _was, ...style } = e.style;
            return {
              ...e,
              style: on
                ? { ...style, outline: { color: '#000000', width: Math.max(1, Math.round(s.fontSize / 30)) } }
                : style,
            };
          });
        }}
      />
      {outline && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 pl-2">
          <Field label="Colour" layout="inline" className="col-span-2">
            <ColorInput
              value={outline.color.slice(0, 7)}
              onChange={(e) => {
                setStyle(
                  { outline: { ...outline, color: withSameAlpha(e.target.value, outline.color) } },
                  `timer-outline:${el.id}`,
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
            onChange={(v) => {
              setStyle({ outline: { ...outline, width: v } }, `timer-outline:${el.id}`);
            }}
          />
        </div>
      )}
      <Choice
        label="Align"
        value={s.align}
        options={[
          { value: 'left', label: 'Left', icon: AlignLeft },
          { value: 'center', label: 'Centre', icon: AlignCenter },
          { value: 'right', label: 'Right', icon: AlignRight },
        ]}
        onChange={(align) => {
          setStyle({ align });
        }}
      />
      <div className="space-y-2 border-t border-line pt-2">
        <p className="text-xs text-faint" data-testid="timer-countdown-note">
          {!timer || countsDown(timer)
            ? 'For a countdown:'
            : 'For a countdown (this timer does not count down, so these change nothing):'}
        </p>
        <Toggle
          label="Another colour in the last minute"
          checked={Boolean(el.lastMinute)}
          data-testid="field-last-minute"
          onChange={(on) => {
            set((e) => {
              const { lastMinute: _was, ...rest } = e;
              return on ? { ...rest, lastMinute: { color: LAST_MINUTE_COLOR } } : rest;
            });
          }}
        />
        {el.lastMinute && (
          <Field label="Colour" layout="inline" className="pl-2">
            <ColorInput
              data-testid="field-last-minute-color"
              value={el.lastMinute.color.slice(0, 7)}
              onChange={(e) => {
                const color = e.target.value;
                set((t) => ({ ...t, lastMinute: { color } }), `last-minute:${el.id}`);
              }}
            />
          </Field>
        )}
        <Field label="At zero" layout="inline">
          <Select
            className="flex-1"
            data-testid="field-at-zero"
            value={el.atZero ?? 'hold'}
            onChange={(e) => {
              const atZero = e.target.value as TimerAtZero;
              set((t) => {
                const { atZero: _was, ...rest } = t;
                return atZero === 'next' ? { ...rest, atZero } : rest;
              });
            }}
          >
            <option value="hold">Hold at 0:00</option>
            <option value="next">The next slide comes on</option>
          </Select>
        </Field>
      </div>
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
