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
import {
  countsDown,
  parseDuration,
  TIMER_KIND_NAMES,
  TIMER_KINDS,
  timerDuration,
  type TimerFields,
  type TimerKind,
  type TimerState,
} from '../../../shared/timers';
import { slideTimerWarn } from '../../../shared/slide-timer';
import { useEngine } from '../engine/engine-store';
import { cueInputName, legacyFontOf, slidesOf } from '../../../shared/slide-edit';
import {
  drawnPx,
  FLOOR_NOTE_PX,
  FLOOR_WARN_PX,
  floorOf,
  INDIC_LINE_HEIGHT_MIN,
  REFERENCE_LINES,
} from '../../../shared/readable';
import { isIndic, SHAPE_KINDS, SHAPE_NAMES, TIMER_FORMATS, type TimerFormat } from '../../../shared/model';
import { DEFAULT_DRAWING } from '../../../shared/shape-path';
import { wordsContrast, WORDS_CONTRAST_AIM, WORDS_CONTRAST_MIN } from '../../../shared/contrast';
import { LANG_NAMES } from '../../../shared/themes';
import { boxLines } from '../../../shared/tracks';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { ColorInput, Field, NumberInput, Select, Slider, TextInput } from '../ui/Field';
import { AlignCenter, AlignLeft, AlignRight, CopyPlus, Trash2 } from '../ui/icons';
import type { Icon } from '../ui/icons';
import { Checkbox, Toggle } from '../ui/Toggle';
import { LOWER_THIRD_FONTS } from '../../../shared/lower-third-fonts';
import { commit, noteOutside, startEditing, useEditor } from './editor-store';
import { MissingFontNote } from './FontOptions';
import type { BoxPatch, TextPatch } from './ops';
import { deleteElements, duplicateElements, findSlide, mapElements, styleBox } from './ops';
import { restyle, restyleAll, selectedLook } from './runs-doc';
import { SlidePanel } from './SlidePanel';
import { useTickerOver } from './SafeAreas';
import { SourceObjectFormat, TableEditor } from './SourceObjectTools';
import { activeText, finishTextEditing } from './TextBoxEditor';
import { ObjectsPane } from './ObjectsPane';

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
  const groupId = selected[0]?.groupId;
  const tableObjects =
    groupId && selected.every((element) => element.groupId === groupId)
      ? slide.elements.filter((element) => element.groupId === groupId)
      : single
        ? [single]
        : [];
  const cells = tableObjects.filter(
    (element): element is TextElement => element.kind === 'text' && !!element.tableCell && !element.hidden,
  );

  const change = (ids: readonly string[], fn: (el: SlideElement) => SlideElement, coalesce?: string) => {
    const now = useEditor.getState().doc;
    if (now) commit(mapElements(now, slide.id, ids, fn), coalesce ? { coalesce } : {});
  };
  return (
    <aside
      className="w-72 shrink-0 overflow-y-auto border-l border-line bg-panel"
      aria-label="Inspector"
      data-testid="inspector"
    >
      <div className="px-3 pt-2 empty:hidden">
        <MissingFontNote elements={slide.elements} />
      </div>
      <ObjectsPane slide={slide} />
      {selected.length === 0 ? (
        <>
          <p className="px-3 pt-3 text-xs text-faint">
            Choose something on the slide to change it, or add a text box, a shape, a picture or a video from
            Insert along the top.
          </p>
          {doc.master?.id === slide.id ? (
            <p className="p-3 text-sm text-muted">
              This master sits behind the presentation’s own slides. Use Insert, Words and Arrange here;
              Design changes its background. Done editing master returns to the slide.
            </p>
          ) : (
            <SlidePanel doc={doc} slide={slide} />
          )}
        </>
      ) : (
        <>
          <Section title={single ? 'Selected' : `${selected.length} selected`} testId="inspector-arrange">
            {/* Lining up, spacing out, front and back: the Arrange group along the top (Session 55, Part 17a). */}
            <div className="flex flex-wrap gap-1">
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
          {cells.length > 0 && (
            <Section title="Table">
              <TableEditor
                cells={cells}
                activeId={editing ?? single?.id}
                edit={(id) => {
                  if (editing === id) {
                    activeText()?.view.focus();
                    return;
                  }
                  finishTextEditing();
                  startEditing(id);
                }}
              />
            </Section>
          )}
          {single && <PlaceSection el={single} change={change} />}
          {single && (
            <div className="space-y-2 px-3 py-2 empty:hidden">
              <SourceObjectFormat element={single} update={(next) => change([single.id], () => next)} />
            </div>
          )}
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
  // Over a picture or video, or a video input's live picture (Session 51).
  const overPicture =
    slide?.cues.some((c) => c.kind === 'background' && (c.mediaId !== null || cueInputName(c) !== null)) ??
    false;
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

/**
 * A text box's own settings in the side panel (since Session 55, Part 17a, how its words look is the Words group's,
 * along the top): whether the hall can read them, what the Words group styles (the box, or the words selected while
 * typing), the words' language and weight, shrinking to fit, and showing on every screen of a kirtan.
 */
function TextSection({ el, slideId, editing }: { el: TextElement; slideId: string; editing: boolean }) {
  const legacy = legacyFontOf(el);
  const active = editing ? activeText() : null;
  const words = active !== null && !active.view.state.selection.empty;
  // What the side panel shows: the selected words' look over the box's.
  const look = active ? selectedLook(active.view.state) : {};
  const s = el.style;
  // The whole box with lines in more than one language (a kirtan's tracks) is in several, not one of them.
  const several = !words && new Set(boxLines(el).flatMap((l) => (l.lang ? [l.lang] : []))).size > 1;
  const shown = {
    lang: look.lang !== undefined ? look.lang : el.lang,
    weight: look.weight ?? s.fontWeight,
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

  return (
    <Section title="Words" testId="inspector-text">
      <Readability el={el} />
      <p className="text-xs text-faint" data-testid="text-target">
        {words
          ? 'Styling the selected words.'
          : 'Styling the whole box. Select words while typing to style just them.'}
      </p>
      <p className="text-xs text-faint">Their font, size, colour and more are under Words along the top.</p>
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
      <div className="space-y-2 border-t border-line pt-2">
        <p className="text-xs text-faint">For the whole box:</p>
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
            if (next === 'path')
              set({
                shape: 'path',
                path: el.path ?? structuredClone(DEFAULT_DRAWING),
                fill: null,
                outline: outline ?? { color: '#ffffff', width: 3 },
              });
            else if (next === 'line')
              set({
                shape: 'line',
                path: undefined,
                fill: null,
                outline: outline ?? { color: el.fill?.slice(0, 7) ?? '#ffffff', width: 6 },
                frame: { ...el.frame, y: el.frame.y + el.frame.height / 2 - 10, height: 20 },
              });
            else set({ shape: next, path: undefined, fill: el.fill ?? (kind === 'line' ? '#000000' : null) });
          }}
        >
          {SHAPE_KINDS.map((shape) => (
            <option key={shape} value={shape}>
              {SHAPE_NAMES[shape]}
            </option>
          ))}
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
          {/* Its play bar on the screens (Session 54), as a deck's video shows one: off unless ticked. */}
          <Toggle
            label="Show the play bar on the screens"
            checked={el.playBar === true}
            data-testid="field-play-bar"
            onChange={(on) => {
              set((m) => {
                const { playBar: _p, ...rest } = m;
                return on ? { ...rest, playBar: true } : rest;
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

/** A countdown's warning colour until the operator chooses theirs (Session 50's last minute, Session 55's warning). */
const LAST_MINUTE_COLOR = '#f5a524';

const FORMAT_NAMES: Record<TimerFormat, string> = {
  auto: 'As needed (5:00, 1:05:00)',
  mss: 'Minutes and seconds (65:00)',
  hmmss: 'Hours too (0:05:00)',
};

/**
 * The timer itself, changed from the slide (Session 55, Part 15): its kind, a countdown's length, or the time a
 * countdown to a time counts to. It is the library's timer, so every slide, message and screen showing it changes.
 */
function TimerTime({ timer }: { timer: TimerState }) {
  const [length, setLength] = useState(timerDuration(timer.durationMs, false));
  const [at, setAt] = useState(timer.targetTime ?? '19:30');
  const [problem, setProblem] = useState<string | null>(null);
  const save = (patch: Partial<TimerFields>) => {
    const { name, kind, durationMs, targetTime, allowsOverrun } = timer;
    const before: TimerFields = { name, kind, durationMs, targetTime, allowsOverrun };
    const after: TimerFields = { ...before, ...patch };
    const id = timer.id;
    void window.drashti.timers.update(id, after).then((r) => {
      setProblem(r.ok ? null : r.message);
      // One step for the editor's Undo and Redo too (Session 55, Part 17a), though the timer is the library's.
      if (r.ok)
        noteOutside({
          undo: () => void window.drashti.timers.update(id, before),
          redo: () => void window.drashti.timers.update(id, after),
        });
    });
  };
  const saveLength = () => {
    const ms = parseDuration(length);
    if (ms === null || ms <= 0) {
      setProblem('Write the length as minutes and seconds, for example 5:00.');
      return;
    }
    if (ms !== timer.durationMs) save({ durationMs: ms });
  };
  const saveAt = (value: string) => {
    if (/^([01]?\d|2[0-3]):[0-5]\d$/u.test(value) && value !== timer.targetTime) save({ targetTime: value });
  };
  return (
    <div className="space-y-2">
      <Field label="Kind" layout="inline">
        <Select
          className="flex-1"
          data-testid="field-timer-kind"
          value={timer.kind}
          onChange={(e) => {
            const kind = e.target.value as TimerKind;
            save({
              kind,
              durationMs: kind === 'countdown' ? timer.durationMs || 300_000 : timer.durationMs,
              targetTime: kind === 'countdown_to_time' ? (timer.targetTime ?? at) : timer.targetTime,
            });
          }}
        >
          {TIMER_KINDS.map((k) => (
            <option key={k} value={k}>
              {TIMER_KIND_NAMES[k]}
            </option>
          ))}
        </Select>
      </Field>
      {timer.kind === 'countdown' && (
        <Field label="Length" layout="inline">
          <TextInput
            className="w-24"
            data-testid="field-timer-length"
            value={length}
            placeholder="5:00"
            onChange={(e) => {
              setLength(e.target.value);
            }}
            onBlur={saveLength}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveLength();
            }}
          />
        </Field>
      )}
      {timer.kind === 'countdown_to_time' && (
        <Field label="Counts down to" layout="inline">
          <TextInput
            type="time"
            data-testid="field-timer-time"
            value={at}
            onChange={(e) => {
              setAt(e.target.value);
            }}
            onBlur={() => {
              saveAt(at);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveAt(at);
            }}
          />
        </Field>
      )}
      <p className="text-xs text-faint">The timer itself changes, everywhere it shows.</p>
      {problem && (
        <p role="alert" className="text-xs text-warning-fg">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * A Timer's own settings (Session 50): which timer it shows; its look, as words have (font, size, weight,
 * colour, shadow, outline, alignment); a countdown's last minute in another colour (off until chosen); and what
 * a countdown does at zero (holds at 0:00, or the next slide comes on).
 */
function TimerSection({ el, change }: { el: TimerElement; change: Change }) {
  const timers = useEngine((e) => e.state?.timers) ?? NO_TIMERS;
  const timer = timers.find((t) => t.id === el.timerId);
  // Its warning (Session 55): its own, else an older slide's last minute.
  const warn = slideTimerWarn(el);
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
      {/* Its time and kind, the timer's own (Session 55, Part 15). */}
      {timer && (
        <TimerTime
          key={`${timer.id}:${timer.kind}:${String(timer.durationMs)}:${timer.targetTime ?? ''}`}
          timer={timer}
        />
      )}
      {timer?.kind !== 'clock' && (
        <Field label="Format" layout="inline">
          <Select
            className="flex-1"
            data-testid="field-timer-format"
            value={el.format ?? 'auto'}
            onChange={(e) => {
              const format = e.target.value as TimerFormat;
              set((t) => {
                const { format: _was, ...rest } = t;
                return format === 'auto' ? rest : { ...rest, format };
              });
            }}
          >
            {TIMER_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_NAMES[f]}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {/* Drashti's bundled fonts only (Session 55, Part 17a), as the Words group offers them. */}
      <Field label="Font" layout="inline">
        <Select
          className="flex-1"
          data-testid="field-timer-font"
          value={s.fontFamily ?? ''}
          onChange={(e) => {
            setStyle({ fontFamily: e.target.value === '' ? null : e.target.value });
          }}
        >
          <option value="">Drashti’s own</option>
          {s.fontFamily !== null && !(LOWER_THIRD_FONTS as readonly string[]).includes(s.fontFamily) && (
            <option value={s.fontFamily} disabled>
              {s.fontFamily} (not one of Drashti’s)
            </option>
          )}
          {LOWER_THIRD_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
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
        {/* A warning colour from a time left (Session 55; an older slide's last minute is one from a minute left). */}
        <Checkbox
          label="A warning colour near the end"
          className="text-xs"
          checked={warn !== null}
          data-testid="field-timer-warn"
          onChange={(e) => {
            const on = e.target.checked;
            set((t) => {
              const { lastMinute: _old, warn: _was, ...rest } = t;
              return on ? { ...rest, warn: { fromMs: 60_000, color: LAST_MINUTE_COLOR } } : rest;
            });
          }}
        />
        {warn && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-2">
            <NumberField
              label="From (seconds left)"
              value={Math.round(warn.fromMs / 1000)}
              min={1}
              max={3600}
              testId="field-timer-warn-from"
              onChange={(v) => {
                set((t) => {
                  const { lastMinute: _old, ...rest } = t;
                  return { ...rest, warn: { ...warn, fromMs: Math.round(v) * 1000 } };
                }, `timer-warn:${el.id}`);
              }}
            />
            <ColorInput
              aria-label="Warning colour"
              data-testid="field-timer-warn-color"
              value={warn.color.slice(0, 7)}
              onChange={(e) => {
                const color = e.target.value;
                set((t) => {
                  const { lastMinute: _old, ...rest } = t;
                  return { ...rest, warn: { ...warn, color } };
                }, `timer-warn:${el.id}`);
              }}
            />
          </div>
        )}
        <Checkbox
          label="Another colour at zero"
          className="text-xs"
          checked={el.overColor !== undefined}
          data-testid="field-timer-over"
          onChange={(e) => {
            const on = e.target.checked;
            set((t) => {
              const { overColor: _was, ...rest } = t;
              return on ? { ...rest, overColor: '#ff6b6b' } : rest;
            });
          }}
        />
        {el.overColor !== undefined && (
          <Field label="Colour" layout="inline" className="pl-2">
            <ColorInput
              data-testid="field-timer-over-color"
              value={el.overColor.slice(0, 7)}
              onChange={(e) => {
                const overColor = e.target.value;
                set((t) => ({ ...t, overColor }), `timer-over:${el.id}`);
              }}
            />
          </Field>
        )}
        <Checkbox
          label="Flash for ten seconds at zero"
          className="text-xs"
          checked={el.flash === true}
          data-testid="field-timer-flash"
          onChange={(e) => {
            const on = e.target.checked;
            set((t) => {
              const { flash: _was, ...rest } = t;
              return on ? { ...rest, flash: true } : rest;
            });
          }}
        />
        <Field label="At zero" layout="inline">
          <Select
            className="flex-1"
            data-testid="field-at-zero"
            value={el.atZero ?? 'hold'}
            onChange={(e) => {
              const atZero = e.target.value as TimerAtZero;
              set((t) => {
                const { atZero: _was, ...rest } = t;
                return atZero === 'hold' ? rest : { ...rest, atZero };
              });
            }}
          >
            <option value="hold">Hold at 0:00</option>
            <option value="next">The next slide comes on</option>
            <option value="message">Show a message in its place</option>
            <option value="gone">It goes</option>
          </Select>
        </Field>
        {el.atZero === 'message' && (
          <Field label="Message at zero" layout="inline" className="pl-2">
            <TextInput
              className="flex-1"
              data-testid="field-timer-zero-text"
              value={el.zeroText ?? ''}
              maxLength={200}
              placeholder="Time is up"
              onChange={(e) => {
                const zeroText = e.target.value;
                set((t) => ({ ...t, zeroText }), `timer-zero-text:${el.id}`);
              }}
            />
          </Field>
        )}
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
